import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/auth.guard';
import { generateApiKey, getKeyPrefix, hmacSha256 } from '../../common/crypto.util';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArsSettingsService } from './ars-settings.service';
import { parseOrigins } from './widget.service';
import { randomBytes } from 'crypto';

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
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly settings: ArsSettingsService) {}

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
        callerPhoneMasked: true, integrityVerdict: true, confirmKey: true, createdAt: true, finishedAt: true },
    });
  }

  /** Service defaults the customer's per-app settings fall back to. */
  @Get('defaults')
  async defaults(@Req() req: AuthenticatedRequest) {
    this.userId(req);
    const s = await this.settings.get();
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
