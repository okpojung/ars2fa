import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { hmacSha256 } from '../../common/crypto.util';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArsSessionService } from './ars-session.service';
import { ArsSettingsService } from './ars-settings.service';
import { maskPhone, normalizeKrPhone, openText } from './phone.util';

/** Normalizes "https://Example.com:443/" -> "https://example.com". */
export function normalizeOrigin(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function parseOrigins(list?: string | null): string[] {
  return (list ?? '').split(/[,\s]+/).map((s) => normalizeOrigin(s)).filter((s): s is string => !!s);
}

/**
 * Web widget (widget.js): a web site with a public site key starts a PC-mode authentication from the browser.
 * The popup page (/w/pc/<token>) shows the QR, the code and the result and posts the result back to the page;
 * the customer's server confirms it with its secret API key (POST /v1/widget/verify) before trusting it.
 */
@Injectable()
export class WidgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessions: ArsSessionService,
    private readonly settings: ArsSettingsService,
  ) {}

  async start(input: { siteKey: string; origin?: string; ip?: string; countryCode?: string; phone: string; purpose?: string }) {
    const origin = normalizeOrigin(input.origin);
    if (!origin) throw new ForbiddenException('ORIGIN_REQUIRED');
    const app = input.siteKey && /^pk_[A-Za-z0-9_-]{16,64}$/.test(input.siteKey)
      ? await this.prisma.applicationApp.findUnique({ where: { siteKey: input.siteKey }, include: { application: { include: { apiKeys: true } } } })
      : null;
    if (!app || app.platform !== 'WEB') throw new UnauthorizedException('INVALID_SITE_KEY');
    if (app.status !== 'APPROVED' || app.application.status !== 'APPROVED') throw new ForbiddenException('SITE_NOT_APPROVED');
    if (!parseOrigins(app.allowedOrigins).includes(origin)) throw new ForbiddenException('ORIGIN_NOT_ALLOWED');
    const key = app.application.apiKeys.find((k) => k.status === 'ACTIVE' && (!k.expiresAt || k.expiresAt > new Date()));
    if (!key) throw new ForbiddenException('API_KEY_DISABLED');

    // abuse limits: per browser IP and per site, plus the key's monthly limit
    const minute = Math.floor(Date.now() / 60_000);
    if (input.ip) {
      const perIp = await this.redis.incrementWithTtl(`widget:ip:${input.ip}:${Math.floor(Date.now() / 600_000)}`, 1200);
      if (perIp > 8) throw new HttpException({ code: 'TOO_MANY_REQUESTS', message: '잠시 후 다시 시도해 주세요.' }, 429);
    }
    const perKey = await this.redis.incrementWithTtl(`rate:${key.id}:${minute}`, 120);
    if (perKey > (key.rateLimitPerMinute ?? 60)) throw new HttpException('RATE_LIMIT_EXCEEDED', 429);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if ((await this.prisma.arsSession.count({ where: { apiKeyId: key.id, createdAt: { gte: monthStart } } })) >= key.monthlyLimit) {
      throw new HttpException('MONTHLY_LIMIT_EXCEEDED', 429);
    }
    const phone = normalizeKrPhone(input.phone);
    if (!phone) throw new BadRequestException('INVALID_PHONE');
    if (input.ip && phone) {
      const perPhone = await this.redis.incrementWithTtl(`widget:phone:${hmacSha256('w', phone)}:${Math.floor(Date.now() / 600_000)}`, 1200);
      if (perPhone > 5) throw new HttpException({ code: 'TOO_MANY_REQUESTS', message: '같은 번호로 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.' }, 429);
    }

    const created = await this.sessions.create({ apiKeyId: key.id, app }, {
      mode: 'PC', expected_phone: phone, country_code: input.countryCode ?? '82', purpose: input.purpose,
    });
    const widgetToken = randomBytes(18).toString('base64url');
    await this.prisma.arsSession.update({ where: { sessionId: created.session_id }, data: { widgetToken, widgetOrigin: origin } });
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    const base = (process.env.PUBLIC_DIAL_BASE_URL ?? process.env.APP_URL ?? '').replace(/\/+$/, '');
    return { session_id: created.session_id, popup_url: `${base}/w/pc/${widgetToken}`, expires_at: created.expires_at, server_time: new Date().toISOString() };
  }

  /** Popup page state (public, addressed by the one-time widget token). */
  async popup(token: string) {
    const s = token && /^[A-Za-z0-9_-]{20,40}$/.test(token) ? await this.prisma.arsSession.findUnique({ where: { widgetToken: token } }) : null;
    const now = new Date();
    if (!s) return { state: 'NOT_FOUND', server_time: now.toISOString() };
    await this.sessions.expireDue();
    const cur = (await this.prisma.arsSession.findUnique({ where: { id: s.id } }))!;
    const base = (process.env.PUBLIC_DIAL_BASE_URL ?? process.env.APP_URL ?? '').replace(/\/+$/, '');
    const out: Record<string, unknown> = {
      state: cur.status, session_id: cur.sessionId, origin: cur.widgetOrigin, display_name: cur.displayName,
      fail_reason: cur.failReason, expires_at: cur.expiresAt.toISOString(), server_time: now.toISOString(),
      phone_masked: cur.callerPhoneMasked,
    };
    if (cur.status === 'PENDING' && cur.dialToken) out.dial_page_url = `${base}/m/ars/${cur.dialToken}`;
    if (cur.status === 'CALL_CONFIRMED') {
      Object.assign(out, { pc_code: cur.pcCode, code_expires_at: cur.codeExpiresAt?.toISOString() ?? null, code_seconds: (await this.settings.get()).pcCodeSeconds });
    }
    return out;
  }

  /**
   * Customer server check (secret API key). consume=true marks the result used, so one verification can back
   * only one sign-up / form submission.
   */
  async verify(apiKeyRaw: string | undefined, sessionId: string, consume: boolean) {
    if (!apiKeyRaw) throw new UnauthorizedException('UNAUTHORIZED_API_KEY');
    const keyHash = hmacSha256(process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret', apiKeyRaw);
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash }, include: { application: true } });
    if (!key || key.status !== 'ACTIVE' || key.application.status !== 'APPROVED') throw new UnauthorizedException('UNAUTHORIZED_API_KEY');
    return this.verifyForKey(key.id, sessionId, consume);
  }

  async verifyForKey(apiKeyId: string, sessionId: string, consume: boolean) {
    const key = { id: apiKeyId };
    const s = await this.prisma.arsSession.findUnique({ where: { sessionId } });
    if (!s || s.apiKeyId !== key.id) throw new NotFoundException('SESSION_NOT_FOUND');
    let verified = s.status === 'VERIFIED';
    let reason: string | null = verified ? null : s.failReason ?? s.status.toLowerCase();
    if (verified && consume) {
      const r = await this.prisma.arsSession.updateMany({ where: { id: s.id, widgetConsumedAt: null }, data: { widgetConsumedAt: new Date() } });
      if (r.count === 0) { verified = false; reason = 'already_used'; }
    }
    return {
      session_id: s.sessionId, verified, status: s.status, reason,
      phone: verified && s.callerPhoneEnc ? openText(s.callerPhoneEnc) : null,
      phone_masked: s.callerPhoneMasked ?? maskPhone(null), verified_at: s.status === 'VERIFIED' ? s.finishedAt?.toISOString() ?? null : null,
      origin: s.widgetOrigin, purpose: s.purpose,
    };
  }
}
