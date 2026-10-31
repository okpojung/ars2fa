import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/**
 * Cloudflare Turnstile (bot protection on sign-up). Enabled when TURNSTILE_SECRET is set (server env only);
 * the public site key (TURNSTILE_SITE_KEY) is handed to the sign-up page through /api/auth/config.
 */
@Injectable()
export class TurnstileService {
  private readonly log = new Logger('Turnstile');
  verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  get siteKey(): string | null {
    return process.env.TURNSTILE_SECRET ? process.env.TURNSTILE_SITE_KEY ?? null : null;
  }

  /** Throws 400 TURNSTILE_FAILED unless Cloudflare confirms the token (no-op when not configured). */
  async verify(token: string | undefined, remoteIp?: string) {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) return;
    if (!token || token.length > 2048) throw new BadRequestException({ code: 'TURNSTILE_REQUIRED', message: '자동가입 방지 확인을 완료해 주세요.' });
    let ok = false;
    let codes: string[] = [];
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      const r = await fetch(this.verifyUrl, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { success?: boolean; hostname?: string; 'error-codes'?: string[] };
      codes = j['error-codes'] ?? [];
      const host = process.env.TURNSTILE_HOSTNAME ?? 'ars2fa.baro.me';
      ok = j.success === true && (!j.hostname || j.hostname === host);
    } catch (e) {
      this.log.warn(`siteverify error: ${(e as Error).message}`);
    }
    if (!ok) {
      this.log.warn(`sign-up blocked by Turnstile: ${codes.join(',') || 'no success'}`);
      throw new BadRequestException({ code: 'TURNSTILE_FAILED', message: '자동가입 방지 확인에 실패했습니다. 다시 시도해 주세요.' });
    }
  }
}
