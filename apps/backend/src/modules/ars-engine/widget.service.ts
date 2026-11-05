import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApplicationApp, Prisma } from '@prisma/client';
import { ClientInfo, geoRisk } from './client-info.util';

/** Client info without the raw User-Agent string. */
export function summarizeClient(v: unknown) {
  if (!v || typeof v !== 'object') return null;
  const { ua: _ua, ...rest } = v as ClientInfo;
  return rest;
}
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

  async start(input: { siteKey: string; origin?: string; ip?: string; countryCode?: string; phone: string; purpose?: string; clientInfo?: ClientInfo }) {
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

    return this.startForClient({ apiKeyId: key.id, app }, { origin, ip: input.ip, phone: input.phone, countryCode: input.countryCode, purpose: input.purpose, clientInfo: input.clientInfo });
  }

  /**
   * Starts a PC-mode authentication shown in the popup (/w/pc/<token>) for an already resolved client.
   * Used by the widget, the admin/customer live tests and the ARS2FA sign-up page.
   */
  async startForClient(client: { apiKeyId: string; app: ApplicationApp }, input: { origin: string; ip?: string; phone: string; countryCode?: string; purpose?: string; clientInfo?: ClientInfo }) {
    const key = await this.prisma.apiKey.findUniqueOrThrow({ where: { id: client.apiKeyId } });
    // abuse limits: per browser IP, per phone and per key, plus the key's monthly limit
    const minute = Math.floor(Date.now() / 60_000);
    const limits = process.env.WIDGET_LIMITS !== 'off'; // only the test suite turns these off
    if (limits && input.ip) {
      const perIp = await this.redis.incrementWithTtl(`widget:ip:${input.ip}:${Math.floor(Date.now() / 600_000)}`, 1200);
      if (perIp > 8) throw new HttpException({ code: 'TOO_MANY_REQUESTS', message: '잠시 후 다시 시도해 주세요.' }, 429);
    }
    const perKey = await this.redis.incrementWithTtl(`rate:${key.id}:${minute}`, 120);
    if (perKey > (key.rateLimitPerMinute ?? 60)) throw new HttpException('RATE_LIMIT_EXCEEDED', 429);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (key.monthlyLimit > 0 && (await this.prisma.arsSession.count({ where: { apiKeyId: key.id, createdAt: { gte: monthStart } } })) >= key.monthlyLimit) {
      throw new HttpException('MONTHLY_LIMIT_EXCEEDED', 429);
    }
    const phone = normalizeKrPhone(input.phone);
    if (!phone) throw new BadRequestException('INVALID_PHONE');
    const perPhone = limits ? await this.redis.incrementWithTtl(`widget:phone:${hmacSha256('w', phone)}:${Math.floor(Date.now() / 600_000)}`, 1200) : 0;
    if (perPhone > 5) throw new HttpException({ code: 'TOO_MANY_REQUESTS', message: '같은 번호로 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.' }, 429);

    const created = await this.sessions.create(client, { mode: 'PC', expected_phone: phone, country_code: input.countryCode ?? '82', purpose: input.purpose });
    const widgetToken = randomBytes(18).toString('base64url');
    await this.prisma.arsSession.update({ where: { sessionId: created.session_id }, data: { widgetToken, widgetOrigin: input.origin,
      ...(input.clientInfo ? { pcClient: input.clientInfo as Prisma.InputJsonValue } : {}) } });
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    const base = (process.env.PUBLIC_DIAL_BASE_URL ?? process.env.APP_URL ?? '').replace(/\/+$/, '');
    return { session_id: created.session_id, popup_url: `${base}/w/pc/${widgetToken}`, expires_at: created.expires_at, server_time: new Date().toISOString() };
  }

  /** Our own page origin (fallback when the request carries none, e.g. same-origin GET-less calls). */
  ownOrigin(origin?: string | null) {
    return normalizeOrigin(origin) ?? normalizeOrigin(process.env.APP_URL) ?? 'https://ars2fa.baro.me';
  }

  /**
   * Built-in apps that ARS2FA itself uses (admin live test, sign-up phone check), kept under one internal
   * application with an internal key that is never handed out.
   */
  async systemClient(name: string, platform: 'ANDROID' | 'WEB', displayName: string) {
    let user = await this.prisma.user.findUnique({ where: { email: 'admin-test@ars2fa.local' } });
    if (!user) user = await this.prisma.user.create({ data: { email: 'admin-test@ars2fa.local', passwordHash: '!', companyName: 'ars2fa', contactName: '시스템', contactPhone: '00000000000', status: 'SUSPENDED' } });
    let application = await this.prisma.apiApplication.findFirst({ where: { userId: user.id }, include: { apiKeys: true }, orderBy: { createdAt: 'asc' } });
    if (!application) {
      await this.prisma.apiApplication.create({ data: { userId: user.id, serviceName: '관리자 실통화 시험', usagePurpose: 'internal', expectedMonthlyRequests: 0, status: 'APPROVED' } });
      application = await this.prisma.apiApplication.findFirst({ where: { userId: user.id }, include: { apiKeys: true }, orderBy: { createdAt: 'asc' } });
    }
    let key = application!.apiKeys.find((k) => k.status === 'ACTIVE');
    if (!key) key = await this.prisma.apiKey.create({ data: { applicationId: application!.id, keyPrefix: 'internal', keyHash: `internal-${randomBytes(16).toString('hex')}`, status: 'ACTIVE', monthlyLimit: 100000, rateLimitPerMinute: 120 } });
    let app = await this.prisma.applicationApp.findFirst({ where: { applicationId: application!.id, mobileAppName: name } });
    if (!app) app = await this.prisma.applicationApp.create({ data: { applicationId: application!.id, mobileAppName: name, displayName, platform, status: 'APPROVED', integrityPolicy: 'OFF' } });
    return { apiKeyId: key.id, app };
  }

  /**
   * ARS2FA sign-up: the phone check must be a verified, unused session of the sign-up app, for the same phone,
   * finished within 15 minutes. Marks it used.
   */
  async consumeSignupPhone(sessionId: string | undefined, contactPhone: string) {
    return this.consumePhoneCheck(sessionId, 'ARS2FA-SIGNUP', contactPhone, 15, '인증한 휴대폰 번호와 담당자 연락처가 다릅니다.');
  }

  /**
   * One-time ARS phone check of a built-in app: verified session of that app, same phone, finished within
   * maxAgeMin minutes, not used before. Marks it used and returns the phone.
   */
  async consumePhoneCheck(sessionId: string | undefined, appName: string, expectedPhone: string, maxAgeMin: number, mismatchMsg: string) {
    const fail = (m: string) => new BadRequestException({ code: 'PHONE_NOT_VERIFIED', message: m });
    if (!sessionId || !/^ars_[A-Za-z0-9_-]{10,40}$/.test(sessionId)) throw fail('휴대폰 인증을 완료해 주세요.');
    const s = await this.prisma.arsSession.findUnique({ where: { sessionId }, include: { applicationApp: true } });
    if (!s || s.applicationApp.mobileAppName !== appName || s.status !== 'VERIFIED' || !s.callerPhoneEnc) throw fail('휴대폰 인증을 완료해 주세요.');
    if (!s.finishedAt || Date.now() - s.finishedAt.getTime() > maxAgeMin * 60_000) throw fail('휴대폰 인증 시간이 지났습니다. 다시 인증해 주세요.');
    const phone = openText(s.callerPhoneEnc);
    if (phone !== normalizeKrPhone(expectedPhone)) throw fail(mismatchMsg);
    const r = await this.prisma.arsSession.updateMany({ where: { id: s.id, widgetConsumedAt: null }, data: { widgetConsumedAt: new Date() } });
    if (r.count === 0) throw fail('이미 사용한 휴대폰 인증입니다. 다시 인증해 주세요.');
    return phone;
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
      // who took part: the browser that started it and the phone that opened the QR page (for the customer's fraud checks)
      clients: { requester: summarizeClient(s.pcClient), phone: summarizeClient(s.mobileClient) },
      // record-only signals for the customer's own decision (e.g. extra checks on country mismatch / VPN)
      risk: geoRisk(s.pcClient, s.mobileClient),
    };
  }
}
