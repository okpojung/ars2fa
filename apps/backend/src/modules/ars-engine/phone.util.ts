import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/** Korean phone number to national digits: "+82 10-1234-5678" -> "01012345678". */
export function normalizeKrPhone(raw?: string | null): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  // SIP style "sip:01012345678@host" or "<sip:...>"
  const sip = s.match(/sips?:([^@;>]+)/i);
  if (sip) s = sip[1];
  s = s.replace(/[^0-9+]/g, '');
  if (s.startsWith('+82')) s = '0' + s.slice(3);
  else if (s.startsWith('82') && s.length >= 11) s = '0' + s.slice(2);
  s = s.replace(/\D/g, '');
  return s.length >= 8 && s.length <= 12 ? s : null;
}

export function isKrMobile(phone: string): boolean {
  return /^01[016789][0-9]{7,8}$/.test(phone);
}

/** Withheld / anonymous caller identities seen on SIP trunks. */
export function isHiddenCaller(raw?: string | null): boolean {
  if (!raw) return true;
  const s = String(raw).trim().toLowerCase();
  return s === '' || /anonymous|unknown|restricted|private|unavailable|withheld/.test(s) || normalizeKrPhone(s) === null;
}

export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  return phone.length <= 7 ? `${phone.slice(0, 3)}****` : `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function phoneHash(phone: string): string {
  return createHmac('sha256', process.env.PHONE_HASH_SECRET ?? 'dev-phone-secret').update(`phone:${phone}`).digest('hex');
}

export function valueHash(purpose: string, value: string): string {
  return createHmac('sha256', process.env.PHONE_HASH_SECRET ?? 'dev-phone-secret').update(`${purpose}:${value}`).digest('hex');
}

function encKey(): Buffer {
  const b64 = process.env.PHONE_ENC_KEY;
  if (b64) {
    const k = Buffer.from(b64, 'base64');
    if (k.length === 32) return k;
  }
  // development fallback derived from the hash secret (never used when PHONE_ENC_KEY is set)
  return createHmac('sha256', process.env.PHONE_HASH_SECRET ?? 'dev-phone-secret').update('enc-key').digest();
}

export function sealText(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export function openText(sealed: string): string {
  const buf = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
