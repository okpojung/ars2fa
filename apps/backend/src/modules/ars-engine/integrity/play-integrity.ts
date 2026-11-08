import { createSign } from 'crypto';
import { readFileSync } from 'fs';

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type HttpPost = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number; json: any }>;

export type PlayVerdict = {
  ok: boolean;
  reasons: string[];
  summary: Record<string, unknown>;
};

/** Default HTTP using global fetch (Node >= 18). */
export const fetchPost: HttpPost = async (url, body, headers) => {
  const r = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(8000) });
  let json: any = null;
  try { json = await r.json(); } catch { /* ignore */ }
  return { status: r.status, json };
};

/**
 * Google Play Integrity API: decodes the token server-side with a service account
 * (decodeIntegrityToken) and checks package, nonce/requestHash, freshness, app and device verdicts.
 */
export class PlayIntegrityVerifier {
  private token: { value: string; exp: number } | null = null;

  constructor(private readonly saPath = process.env.GOOGLE_PLAY_INTEGRITY_SA_FILE, private readonly post: HttpPost = fetchPost) {}

  get configured(): boolean {
    return !!this.saPath;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const sa = JSON.parse(readFileSync(this.saPath!, 'utf8')) as ServiceAccount;
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
    const r = await this.post(sa.token_uri ?? 'https://oauth2.googleapis.com/token',
      new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }).toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (r.status !== 200 || !r.json?.access_token) throw new Error(`google oauth failed (${r.status})`);
    this.token = { value: r.json.access_token, exp: Date.now() + (r.json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  async decode(packageName: string, integrityToken: string): Promise<any> {
    const at = await this.accessToken();
    const r = await this.post(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
      JSON.stringify({ integrity_token: integrityToken }), { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' });
    if (r.status !== 200 || !r.json?.tokenPayloadExternal) throw new Error(`decodeIntegrityToken failed (${r.status})`);
    return r.json.tokenPayloadExternal;
  }

  /** Pure verdict evaluation (unit-testable). */
  static evaluate(p: any, expect: { packageName: string; nonce: string; certSha256?: string[]; now?: number; maxAgeMs?: number }): PlayVerdict {
    const reasons: string[] = [];
    const rd = p?.requestDetails ?? {};
    const ai = p?.appIntegrity ?? {};
    const di = p?.deviceIntegrity ?? {};
    if (rd.requestPackageName !== expect.packageName) reasons.push('package_mismatch');
    if (rd.nonce !== expect.nonce && rd.requestHash !== expect.nonce) reasons.push('nonce_mismatch');
    const ts = Number(rd.timestampMillis ?? 0);
    if (!ts || Math.abs((expect.now ?? Date.now()) - ts) > (expect.maxAgeMs ?? 120_000)) reasons.push('stale_token');
    if (ai.appRecognitionVerdict !== 'PLAY_RECOGNIZED') reasons.push(`app_${String(ai.appRecognitionVerdict ?? 'missing').toLowerCase()}`);
    if (ai.packageName && ai.packageName !== expect.packageName) reasons.push('app_package_mismatch');
    if (expect.certSha256?.length) {
      const got: string[] = ai.certificateSha256Digest ?? [];
      if (!got.some((g) => expect.certSha256!.includes(g))) reasons.push('signing_cert_mismatch');
    }
    const dv: string[] = di.deviceRecognitionVerdict ?? [];
    if (!dv.includes('MEETS_DEVICE_INTEGRITY') && !dv.includes('MEETS_STRONG_INTEGRITY')) reasons.push('device_integrity');
    return { ok: reasons.length === 0, reasons, summary: { app: ai.appRecognitionVerdict, device: dv, licensing: p?.accountDetails?.appLicensingVerdict } };
  }
}
