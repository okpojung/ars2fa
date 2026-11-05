import { readFileSync } from 'fs';
import { join } from 'path';
import { X509Certificate } from 'crypto';
import { extractAppleNonce, verifyAttestation } from '../src/modules/ars-engine/integrity/app-attest';
import { decodeCbor } from '../src/modules/ars-engine/integrity/cbor';

// Test chain generated with openssl: P-384 root -> P-384 intermediate -> P-256 leaf carrying the
// 1.2.840.113635.100.8.2 nonce extension, mirroring Apple's App Attest structure.
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures-app-attest.json'), 'utf8'));

function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n])
    : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const e = Object.entries(v as Record<string, unknown>);
  return Buffer.concat([head(5, e.length), ...e.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

function attestation(over: { authData?: Buffer; leaf?: Buffer } = {}) {
  return cbor({ fmt: 'apple-appattest', attStmt: { x5c: [over.leaf ?? Buffer.from(fx.leafDer, 'base64'), Buffer.from(fx.intDer, 'base64')], receipt: Buffer.from('r') },
    authData: over.authData ?? Buffer.from(fx.authData, 'base64') });
}

const base = { keyIdB64: fx.keyId, challenge: fx.challenge, appId: fx.appId, rootPem: fx.rootPem };

test('nonce extension is parsed from the leaf certificate', () => {
  const n = extractAppleNonce(new X509Certificate(Buffer.from(fx.leafDer, 'base64')).raw);
  expect(n?.length).toBe(32);
});

test('valid attestation is accepted and yields the public key', () => {
  expect(decodeCbor(attestation())).toBeInstanceOf(Map);
  const r = verifyAttestation({ ...base, attestationObject: attestation() });
  expect(r.environment).toBe('appattestdevelop');
  expect(r.publicKeyPem).toContain('BEGIN PUBLIC KEY');
});

test('rejects: other root, other challenge, other app id, wrong key id, tampered authData', () => {
  expect(() => verifyAttestation({ ...base, attestationObject: attestation(), rootPem: undefined })).toThrow('Apple root');
  expect(() => verifyAttestation({ ...base, attestationObject: attestation(), challenge: 'x' })).toThrow('nonce mismatch');
  expect(() => verifyAttestation({ ...base, attestationObject: attestation(), appId: 'ZZZZZ99999.com.evil' })).toThrow();
  expect(() => verifyAttestation({ ...base, attestationObject: attestation(), keyIdB64: Buffer.alloc(32).toString('base64') })).toThrow('key id mismatch');
  const ad = Buffer.from(fx.authData, 'base64'); ad[40] ^= 1;
  expect(() => verifyAttestation({ ...base, attestationObject: attestation({ authData: ad }) })).toThrow('nonce mismatch');
});
