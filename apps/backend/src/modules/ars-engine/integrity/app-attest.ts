import { createHash, createPublicKey, verify as cryptoVerify, X509Certificate } from 'crypto';
import { cborGet, decodeCbor } from './cbor';

/** Apple App Attestation Root CA (https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem). */
export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();

export type AuthData = { rpIdHash: Buffer; flags: number; signCount: number; aaguid?: Buffer; credentialId?: Buffer };

export function parseAuthData(d: Buffer): AuthData {
  if (d.length < 37) throw new Error('authData too short');
  const out: AuthData = { rpIdHash: d.subarray(0, 32), flags: d[32], signCount: d.readUInt32BE(33) };
  if (d.length >= 55 && (out.flags & 0x40)) {
    out.aaguid = d.subarray(37, 53);
    const len = d.readUInt16BE(53);
    out.credentialId = d.subarray(55, 55 + len);
  }
  return out;
}

type Tlv = { tag: number; start: number; len: number; end: number };

/** Reads one DER TLV at offset. */
export function readTlv(buf: Buffer, off: number): Tlv {
  const tag = buf[off];
  let lenByte = buf[off + 1];
  let p = off + 2;
  let len = lenByte;
  if (lenByte & 0x80) {
    const n = lenByte & 0x7f;
    if (n < 1 || n > 4) throw new Error('DER: bad length');
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[p++];
  }
  if (p + len > buf.length) throw new Error('DER: truncated');
  return { tag, start: p, len, end: p + len };
}

function children(buf: Buffer, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = t.start; p < t.end;) {
    const c = readTlv(buf, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

const APPLE_NONCE_OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]); // 1.2.840.113635.100.8.2

/**
 * Extracts the nonce from the leaf certificate extension 1.2.840.113635.100.8.2, whose value is
 * SEQUENCE { [1] EXPLICIT OCTET STRING nonce }. Walks Certificate > tbsCertificate > [3] extensions.
 */
export function extractAppleNonce(leafDer: Buffer): Buffer | null {
  const cert = readTlv(leafDer, 0);
  const tbs = children(leafDer, cert)[0];
  const extWrap = children(leafDer, tbs).find((c) => c.tag === 0xa3);
  if (!extWrap) return null;
  const extSeq = children(leafDer, extWrap)[0];
  for (const ext of children(leafDer, extSeq)) {
    const parts = children(leafDer, ext);
    const oid = parts[0];
    if (oid.tag !== 0x06 || !leafDer.subarray(oid.start, oid.end).equals(APPLE_NONCE_OID)) continue;
    const value = parts[parts.length - 1]; // extnValue OCTET STRING (critical flag optional)
    if (value.tag !== 0x04) return null;
    const inner = leafDer.subarray(value.start, value.end);
    const seq = readTlv(inner, 0);
    const tagged = children(inner, seq).find((c) => c.tag === 0xa1);
    if (!tagged) return null;
    const oct = readTlv(inner, tagged.start);
    if (oct.tag !== 0x04) return null;
    return Buffer.from(inner.subarray(oct.start, oct.end));
  }
  return null;
}

/** Raw uncompressed EC point (65 bytes) of a P-256 public key. */
function rawPoint(pub: ReturnType<typeof createPublicKey>): Buffer {
  const jwk = pub.export({ format: 'jwk' }) as { x: string; y: string };
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}

export type AttestationResult = { publicKeyPem: string; environment: 'appattest' | 'appattestdevelop'; signCount: number };

/**
 * Verifies an App Attest attestation object (Apple "Validating apps that connect to your server" steps 1-9).
 * clientDataHash = SHA256(challenge) as sent by the app to DCAppAttestService.attestKey.
 */
export function verifyAttestation(params: {
  attestationObject: Buffer; keyIdB64: string; challenge: string; appId: string; rootPem?: string; now?: Date;
}): AttestationResult {
  const att = decodeCbor(params.attestationObject);
  if (cborGet(att, 'fmt') !== 'apple-appattest') throw new Error('fmt is not apple-appattest');
  const stmt = cborGet(att, 'attStmt');
  const x5c = cborGet(stmt, 'x5c') as Buffer[] | undefined;
  const authDataBuf = cborGet(att, 'authData') as Buffer | undefined;
  if (!Array.isArray(x5c) || x5c.length < 2 || !Buffer.isBuffer(authDataBuf)) throw new Error('malformed attestation');
  const leaf = new X509Certificate(x5c[0]);
  const inter = new X509Certificate(x5c[1]);
  const root = new X509Certificate(params.rootPem ?? APPLE_APP_ATTEST_ROOT_PEM);
  const now = params.now ?? new Date();
  for (const c of [leaf, inter]) {
    if (new Date(c.validFrom) > now || new Date(c.validTo) < now) throw new Error('certificate not valid now');
  }
  if (!inter.verify(root.publicKey) || !leaf.verify(inter.publicKey)) throw new Error('certificate chain does not lead to the Apple root');
  // nonce = SHA256(authData || clientDataHash) must equal the leaf extension
  const clientDataHash = sha256(Buffer.from(params.challenge, 'utf8'));
  const nonce = sha256(Buffer.concat([authDataBuf, clientDataHash]));
  const extNonce = extractAppleNonce(leaf.raw);
  if (!extNonce || !extNonce.equals(nonce)) throw new Error('nonce mismatch');
  // key identifier = SHA256(public key point)
  const point = rawPoint(leaf.publicKey);
  const keyId = Buffer.from(params.keyIdB64, 'base64');
  if (!sha256(point).equals(keyId)) throw new Error('key id mismatch');
  const ad = parseAuthData(authDataBuf);
  if (!ad.rpIdHash.equals(sha256(Buffer.from(params.appId, 'utf8')))) throw new Error('app id mismatch');
  if (ad.signCount !== 0) throw new Error('counter must be 0');
  const aaguid = ad.aaguid?.toString('utf8').replace(/\0+$/, '');
  if (aaguid !== 'appattest' && aaguid !== 'appattestdevelop') throw new Error('bad aaguid');
  if (!ad.credentialId || !ad.credentialId.equals(keyId)) throw new Error('credential id mismatch');
  return { publicKeyPem: leaf.publicKey.export({ type: 'spki', format: 'pem' }).toString(), environment: aaguid, signCount: 0 };
}

/** Verifies an App Attest assertion; returns the new counter (must be greater than the stored one). */
export function verifyAssertion(params: {
  assertion: Buffer; challenge: string; appId: string; publicKeyPem: string; storedCount: number;
}): number {
  const a = decodeCbor(params.assertion);
  const signature = cborGet(a, 'signature') as Buffer | undefined;
  const authData = cborGet(a, 'authenticatorData') as Buffer | undefined;
  if (!Buffer.isBuffer(signature) || !Buffer.isBuffer(authData)) throw new Error('malformed assertion');
  const clientDataHash = sha256(Buffer.from(params.challenge, 'utf8'));
  const nonce = sha256(Buffer.concat([authData, clientDataHash]));
  if (!cryptoVerify('sha256', nonce, createPublicKey(params.publicKeyPem), signature)) throw new Error('bad signature');
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(sha256(Buffer.from(params.appId, 'utf8')))) throw new Error('app id mismatch');
  if (ad.signCount <= params.storedCount) throw new Error('counter did not increase');
  return ad.signCount;
}
