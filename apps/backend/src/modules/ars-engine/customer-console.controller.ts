import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
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
  /** WEB: origins allowed to use the widget (comma separated) */
  @IsOptional() @IsString() @MaxLength(1000) allowedOrigins?: string;
}

/** Customer console (logged-in API customers): own authentication history, per-app settings, key reissue. */
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
    const data: { confirmKeyRequired?: boolean | null; displayName?: string | null; allowedOrigins?: string | null } = {};
    if (dto.allowedOrigins !== undefined) {
      if (app.platform !== 'WEB') throw new ForbiddenException('WEB_APP_ONLY');
      const list = parseOrigins(dto.allowedOrigins);
      if (dto.allowedOrigins.trim() && !list.length) throw new BadRequestException('INVALID_ORIGINS');
      data.allowedOrigins = list.join(',') || null;
    }
    if (dto.confirmKeyRequired !== undefined) data.confirmKeyRequired = dto.confirmKeyRequired;
    if (dto.displayName !== undefined) data.displayName = dto.displayName.trim() || null;
    const updated = await this.prisma.applicationApp.update({ where: { id: app.id }, data,
      select: { id: true, mobileAppName: true, platform: true, displayName: true, confirmKeyRequired: true, integrityPolicy: true, status: true, allowedOrigins: true, siteKey: true } });
    await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'APP_SETTINGS_UPDATE', targetType: 'APPLICATION_APP', targetId: app.id,
      details: { before: { confirmKeyRequired: app.confirmKeyRequired, displayName: app.displayName }, after: data } as never } });
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
  @Post('api-keys/:id/rotate')
  async rotate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = this.userId(req);
    const key = await this.prisma.apiKey.findFirst({ where: { id, application: { userId } }, omit: { keyHash: false } });
    if (!key) throw new NotFoundException('API_KEY_NOT_FOUND');
    if (key.status === 'REVOKED') throw new ForbiddenException('API_KEY_REVOKED');
    const raw = generateApiKey(key.environment as 'TEST' | 'LIVE');
    const keyHash = hmacSha256(process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret', raw);
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { keyHash, keyPrefix: getKeyPrefix(raw) } });
    await this.redis.del(`api-key:${key.keyHash}`).catch(() => undefined);
    await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: userId, action: 'API_KEY_ROTATE', targetType: 'API_KEY', targetId: key.id,
      details: { oldPrefix: key.keyPrefix, newPrefix: getKeyPrefix(raw) } } });
    return { id: key.id, keyPrefix: getKeyPrefix(raw), apiKey: raw, notice: 'API Key 원문은 지금 한 번만 표시됩니다. 서버의 안전한 곳에 보관하세요.' };
  }
}
