import { openText, sealText } from './phone.util';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/auth.guard';
import { generateApiKey, getKeyPrefix, hmacSha256 } from '../../common/crypto.util';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArsSettingsService, CUSTOMER_SETTING_BOUNDS, CUSTOMER_SETTING_KEYS, cleanCustomerSettings } from './ars-settings.service';
import { parseOrigins, WidgetService } from './widget.service';
import { getClientIp } from '../../common/request.util';
import { describeRequest } from './client-info.util';
import { randomBytes } from 'crypto';

export class TestPopupDto {
  @IsString() @MaxLength(40) appId!: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9]{1,4}$/) country_code?: string;
  @IsString() @MaxLength(20) expected_phone!: string;
}

export class TestVerifyDto {
  @IsString() @Matches(/^ars_[A-Za-z0-9_-]{10,40}$/) session_id!: string;
}

export class AppSettingsDto {
  /** true = press 1 required, false = not required, null = follow the service default */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsBoolean() confirmKeyRequired?: boolean | null;
  @IsOptional() @IsString() @MaxLength(40) displayName?: string;
  /** WEB: digits of the code shown in the popup, 3..6; null = account / service default */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(3) @Max(6) pcCodeDigits?: number | null;
  /** time to place the call, seconds (app 15..120, web 20..120); null = service default */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(15) @Max(120) leaseSeconds?: number | null;
  /** WEB: time to key in the code, seconds 10..60; null = service default */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(10) @Max(60) pcCodeSeconds?: number | null;
  /** WEB: origins allowed to use the widget (comma separated) */
  @IsOptional() @IsString() @MaxLength(1000) allowedOrigins?: string;
}

/** Customer console (logged-in API customers): own authentication history, per-app settings, key reissue. */
/** How many times one API key can be viewed again before the next view issues a new key. */
export const MAX_KEY_VIEWS = 3;

@ApiTags('console')
@UseGuards(JwtAuthGuard)
@Controller('api/console')
export class CustomerConsoleController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly settings: ArsSettingsService,
    private readonly widget: WidgetService) {}

  private userId(req: AuthenticatedRequest) {
    if (req.user?.kind !== 'user') throw new ForbiddenException('CUSTOMER_ONLY');
    return req.user.id;
  }

  /** Own ARS authentications (phone numbers masked). */
  @Get('sessions')
  async sessions(@Req() req: AuthenticatedRequest, @Query('status') status?: string, @Query('take') take?: string) {
    const userId = this.userId(req);
    return this.prisma.arsSession.findMany({
      where: { apiKey: { application: { userId } }, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(Number(take ?? 200), 500),
      select: { sessionId: true, mobileAppName: true, clientPlatform: true, mode: true, purpose: true, status: true, failReason: true,
        callerPhoneMasked: true, integrityVerdict: true, confirmKey: true, createdAt: true, finishedAt: true, pcClient: true, mobileClient: true, widgetOrigin: true },
    });
  }

  /** The customer's own ARS settings: effective values, own overrides, service defaults and allowed ranges. */
  @Get('ars-settings')
  async arsSettings(@Req() req: AuthenticatedRequest) {
    const userId = this.userId(req);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { arsSettings: true } });
    const sys = await this.settings.get();
    const own = cleanCustomerSettings(u.arsSettings);
    const pick = (o: Record<string, unknown>) => Object.fromEntries(CUSTOMER_SETTING_KEYS.map((k) => [k, o[k]]));
    return { effective: pick({ ...sys, ...own }), own, defaults: pick(sys as unknown as Record<string, unknown>), bounds: CUSTOMER_SETTING_BOUNDS };
  }

  /** Sets (value) or clears (null = use the service default) the customer's own settings. */
  @Patch('ars-settings')
  async setArsSettings(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const userId = this.userId(req);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { arsSettings: true } });
    const own: Record<string, unknown> = { ...cleanCustomerSettings(u.arsSettings) };
    for (const [k, v] of Object.entries(body ?? {})) {
      if (!(CUSTOMER_SETTING_KEYS as readonly string[]).includes(k)) throw new BadRequestException(`unknown setting ${k}`);
      if (v === null) { delete own[k]; continue; }
      if (k === 'confirmKeyRequired' ? typeof v !== 'boolean' : !(typeof v === 'number' && Number.isInteger(v))) throw new BadRequestException(`invalid ${k}`);
      if (k !== 'confirmKeyRequired') { const [min, max] = CUSTOMER_SETTING_BOUNDS[k]; if ((v as number) < min || (v as number) > max) throw new BadRequestException(`${k} must be ${min}..${max}`); }
      own[k] = v;
    }
    await this.prisma.user.update({ where: { id: userId }, data: { arsSettings: own as never } });
    await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'CUSTOMER_ARS_SETTINGS', targetType: 'USER', targetId: userId, details: own as never } });
    return this.arsSettings(req);
  }

  /** Service defaults the customer's per-app settings fall back to. */
  @Get('defaults')
  async defaults(@Req() req: AuthenticatedRequest) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: this.userId(req) }, select: { arsSettings: true } });
    const s = await this.settings.forCustomer(u.arsSettings);
    return { confirmKeyRequired: s.confirmKeyRequired, callWindowSeconds: s.leaseSecondsApp, pcCallWindowSeconds: s.leaseSecondsPc, pcCodeSeconds: s.pcCodeSeconds, pcCodeDigits: s.pcCodeDigits };
  }

  /** Per-app settings the customer controls: press-1 confirmation and the display name shown to end users. */
  @Patch('apps/:appId/settings')
  async appSettings(@Req() req: AuthenticatedRequest, @Param('appId') appId: string, @Body() dto: AppSettingsDto) {
    const userId = this.userId(req);
    const app = await this.prisma.applicationApp.findFirst({ where: { id: appId, application: { userId } } });
    if (!app) throw new NotFoundException('APP_NOT_FOUND');
    const data: { confirmKeyRequired?: boolean | null; displayName?: string | null; allowedOrigins?: string | null; pcCodeDigits?: number | null;
      leaseSeconds?: number | null; pcCodeSeconds?: number | null } = {};
    if (dto.leaseSeconds !== undefined) {
      if (dto.leaseSeconds !== null && app.platform === 'WEB' && dto.leaseSeconds < 20) throw new BadRequestException('leaseSeconds must be 20..120 for websites');
      data.leaseSeconds = dto.leaseSeconds;
    }
    if (dto.pcCodeSeconds !== undefined) {
      if (app.platform !== 'WEB') throw new ForbiddenException('WEB_APP_ONLY');
      data.pcCodeSeconds = dto.pcCodeSeconds;
    }
    if (dto.pcCodeDigits !== undefined) {
      if (app.platform !== 'WEB') throw new ForbiddenException('WEB_APP_ONLY');
      data.pcCodeDigits = dto.pcCodeDigits;
    }
    if (dto.allowedOrigins !== undefined) {
      if (app.platform !== 'WEB') throw new ForbiddenException('WEB_APP_ONLY');
      const list = parseOrigins(dto.allowedOrigins);
      if (dto.allowedOrigins.trim() && !list.length) throw new BadRequestException('INVALID_ORIGINS');
      data.allowedOrigins = list.join(',') || null;
    }
    if (dto.confirmKeyRequired !== undefined) data.confirmKeyRequired = dto.confirmKeyRequired;
    if (dto.displayName !== undefined) data.displayName = dto.displayName.trim() || null;
    const updated = await this.prisma.applicationApp.update({ where: { id: app.id }, data,
      select: { id: true, mobileAppName: true, platform: true, displayName: true, confirmKeyRequired: true, pcCodeDigits: true, leaseSeconds: true, pcCodeSeconds: true, integrityPolicy: true, status: true, allowedOrigins: true, siteKey: true } });
    await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'APP_SETTINGS_UPDATE', targetType: 'APPLICATION_APP', targetId: app.id,
      details: { before: { confirmKeyRequired: app.confirmKeyRequired, pcCodeDigits: app.pcCodeDigits, leaseSeconds: app.leaseSeconds, pcCodeSeconds: app.pcCodeSeconds, displayName: app.displayName }, after: data } as never } });
    return updated;
  }

  /** WEB apps: issue (or reissue) the public site key used by widget.js. The old key stops working at once. */
  @Post('apps/:appId/site-key')
  async siteKey(@Req() req: AuthenticatedRequest, @Param('appId') appId: string) {
    const userId = this.userId(req);
    const app = await this.prisma.applicationApp.findFirst({ where: { id: appId, application: { userId } } });
    if (!app) throw new NotFoundException('APP_NOT_FOUND');
    if (app.platform !== 'WEB') throw new ForbiddenException('WEB_APP_ONLY');
    const siteKey = `pk_${randomBytes(18).toString('base64url')}`;
    await this.prisma.applicationApp.update({ where: { id: app.id }, data: { siteKey } });
    await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'SITE_KEY_ISSUE', targetType: 'APPLICATION_APP', targetId: app.id, details: { prefix: siteKey.slice(0, 10) } } });
    return { id: app.id, siteKey };
  }

  // ------------------------------------------------------------ live call test (popup)

  /** Approved apps of this customer that can be used for the live test (an active API key is needed). */
  @Get('test/apps')
  async testApps(@Req() req: AuthenticatedRequest) {
    const userId = this.userId(req);
    const apps = await this.prisma.applicationApp.findMany({ where: { status: 'APPROVED', application: { userId, status: 'APPROVED', apiKeys: { some: { status: 'ACTIVE' } } } },
      select: { id: true, mobileAppName: true, displayName: true, platform: true, application: { select: { serviceName: true } } }, orderBy: { createdAt: 'asc' } });
    return apps.map((a) => ({ id: a.id, name: a.displayName || a.mobileAppName, platform: a.platform, service: a.application.serviceName }));
  }

  /** Starts a PC-mode authentication for one of the customer's apps, shown in the popup. Counts as normal usage. */
  @Post('test/popup')
  async testPopup(@Req() req: AuthenticatedRequest, @Body() dto: TestPopupDto) {
    const userId = this.userId(req);
    const app = await this.prisma.applicationApp.findFirst({ where: { id: dto.appId, status: 'APPROVED', application: { userId, status: 'APPROVED' } }, include: { application: { include: { apiKeys: true } } } });
    if (!app) throw new NotFoundException('APP_NOT_FOUND');
    const key = app.application.apiKeys.find((k) => k.status === 'ACTIVE');
    if (!key) throw new ForbiddenException('API_KEY_DISABLED');
    return this.widget.startForClient({ apiKeyId: key.id, app }, { origin: this.widget.ownOrigin(req.header('origin')), ip: getClientIp(req),
      phone: dto.expected_phone, countryCode: dto.country_code, purpose: '실통화 시험', clientInfo: describeRequest(req) });
  }

  /** The server-side check a customer's server would do (here with the customer's own key, without consuming). */
  @Post('test/verify')
  async testVerify(@Req() req: AuthenticatedRequest, @Body() dto: TestVerifyDto) {
    const userId = this.userId(req);
    const s = await this.prisma.arsSession.findFirst({ where: { sessionId: dto.session_id, apiKey: { application: { userId } } } });
    if (!s) throw new NotFoundException('SESSION_NOT_FOUND');
    return this.widget.verifyForKey(s.apiKeyId, s.sessionId, false);
  }

  /**
   * Issues a new secret for one of the customer's API keys and returns it once. The old secret stops working at once.
   * (Keys are created when the application is approved; the customer takes the secret from here.)
   */
  /** Before a key is shown: ARS check of the account's contact phone (verified at sign-up), in the popup. */
  @Post('api-keys/phone/start')
  async keyPhoneStart(@Req() req: AuthenticatedRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: this.userId(req) }, select: { contactPhone: true } });
    const client = await this.widget.systemClient('ARS2FA-KEYISSUE', 'WEB', 'ARS2FA API Key 발급');
    return this.widget.startForClient(client, { origin: this.widget.ownOrigin(req.header('origin')), ip: getClientIp(req),
      phone: user.contactPhone, countryCode: '82', purpose: 'API Key 발급', clientInfo: describeRequest(req) });
  }

  /** Shows the issued key again after an ARS check of the account's contact phone (5 minutes, one use). */
  @Post('api-keys/:id/reveal')
  async reveal(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: { phoneSessionId?: string }) {
    const userId = this.userId(req);
    const key = await this.prisma.apiKey.findFirst({ where: { id, application: { userId } }, omit: { keyEnc: false } });
    if (!key) throw new NotFoundException('API_KEY_NOT_FOUND');
    if (key.status === 'REVOKED') throw new ForbiddenException('API_KEY_REVOKED');
    if (!key.keyEnc) throw new ConflictException({ code: 'KEY_NOT_STORED', message: '이전 방식으로 만든 키라 다시 볼 수 없습니다. [키 받기]로 새 키를 받으세요.' });
    // first view after approval: shown right away (signed in is enough); later views need an ARS phone check
    if (!key.firstShownAt) {
      const first = await this.prisma.apiKey.updateMany({ where: { id: key.id, firstShownAt: null }, data: { firstShownAt: new Date() } });
      if (first.count === 1) {
        await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'API_KEY_FIRST_VIEW', targetType: 'API_KEY', targetId: key.id,
          details: { prefix: key.keyPrefix } } });
        return { id: key.id, keyPrefix: key.keyPrefix, apiKey: openText(key.keyEnc), replaced: false, firstView: true, viewsLeft: MAX_KEY_VIEWS - key.revealCount };
      }
    }    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { contactPhone: true } });
    await this.widget.consumePhoneCheck(typeof body?.phoneSessionId === 'string' ? body.phoneSessionId : undefined, 'ARS2FA-KEYISSUE',
      user.contactPhone, 5, '인증한 휴대폰이 계정의 담당자 연락처와 다릅니다.');
    // up to MAX_KEY_VIEWS views per key; the view after that issues a new key (the old one stops at once)
    const counted = await this.prisma.apiKey.updateMany({ where: { id: key.id, revealCount: { lt: MAX_KEY_VIEWS } }, data: { revealCount: { increment: 1 } } });
    if (counted.count === 0) {
      const raw = generateApiKey(key.environment as 'TEST' | 'LIVE');
      const old = await this.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id }, omit: { keyHash: false } });
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { keyHash: hmacSha256(process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret', raw),
        keyPrefix: getKeyPrefix(raw), keyEnc: sealText(raw), revealCount: 0, firstShownAt: new Date() } });
      await this.redis.del(`api-key:${old.keyHash}`).catch(() => undefined);
      await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'API_KEY_ROTATE', targetType: 'API_KEY', targetId: key.id,
        details: { oldPrefix: key.keyPrefix, newPrefix: getKeyPrefix(raw), reason: 'view_limit' } } });
      return { id: key.id, keyPrefix: getKeyPrefix(raw), apiKey: raw, replaced: true, viewsLeft: MAX_KEY_VIEWS };
    }
    const now = await this.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id }, select: { revealCount: true } });
    await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'API_KEY_REVEAL', targetType: 'API_KEY', targetId: key.id,
      details: { prefix: key.keyPrefix, view: now.revealCount } } });
    return { id: key.id, keyPrefix: key.keyPrefix, apiKey: openText(key.keyEnc), replaced: false, viewsLeft: MAX_KEY_VIEWS - now.revealCount };
  }

  @Post('api-keys/:id/rotate')
  async rotate(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: { phoneSessionId?: string }) {
    const userId = this.userId(req);
    const key = await this.prisma.apiKey.findFirst({ where: { id, application: { userId } }, omit: { keyHash: false } });
    if (!key) throw new NotFoundException('API_KEY_NOT_FOUND');
    if (key.status === 'REVOKED') throw new ForbiddenException('API_KEY_REVOKED');
    // the secret is shown only after an ARS check of the account's own phone (5 minutes, one use)
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { contactPhone: true } });
    await this.widget.consumePhoneCheck(typeof body?.phoneSessionId === 'string' ? body.phoneSessionId : undefined, 'ARS2FA-KEYISSUE',
      user.contactPhone, 5, '인증한 휴대폰이 계정의 담당자 연락처와 다릅니다.');
    const raw = generateApiKey(key.environment as 'TEST' | 'LIVE');
    const keyHash = hmacSha256(process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret', raw);
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { keyHash, keyPrefix: getKeyPrefix(raw), keyEnc: sealText(raw), revealCount: 0, firstShownAt: new Date() } });
    await this.redis.del(`api-key:${key.keyHash}`).catch(() => undefined);
    await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'API_KEY_ROTATE', targetType: 'API_KEY', targetId: key.id,
      details: { oldPrefix: key.keyPrefix, newPrefix: getKeyPrefix(raw) } } });
    return { id: key.id, keyPrefix: getKeyPrefix(raw), apiKey: raw, notice: 'API Key 원문은 지금 한 번만 표시됩니다. 서버의 안전한 곳에 보관하세요.' };
  }
}
