import { createHmac, randomBytes } from 'crypto';

export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function generateApiKey(environment: 'TEST' | 'LIVE' = 'TEST'): string {
  const prefix = environment === 'LIVE' ? 'ars2fa_live_' : 'ars2fa_test_';
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export function getKeyPrefix(apiKey: string): string {
  if (apiKey.length <= 18) {
    return apiKey;
  }
  return `${apiKey.slice(0, 14)}...${apiKey.slice(-4)}`;
}

export function normalizePhoneNumber(phoneNumber?: string | null): string | null {
  if (!phoneNumber) {
    return null;
  }
  const normalized = phoneNumber.replace(/\D/g, '');
  return normalized.length > 0 ? normalized : null;
}

export function maskPhoneNumber(phoneNumber?: string | null): string | null {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 7) {
    return `${normalized.slice(0, 3)}****`;
  }
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

export function maskSensitivePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const sensitiveKeys = new Set([
    'api_key',
    'authorization',
    'appphone',
    'app_cid',
    'inst_phone_no',
    'prnts_phone_no',
  ]);

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      if (sensitiveKeys.has(key.toLowerCase())) {
        return [key, '[MASKED]'];
      }
      return [key, value];
    }),
  );
}
