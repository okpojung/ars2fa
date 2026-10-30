import {
  Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/auth.guard';
import { getClientIp } from '../../common/request.util';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyAuthService, ClientIdentity } from './api-key-auth.service';
import { ArsSessionService } from './ars-session.service';
import { ArsSettingsService } from './ars-settings.service';
import {
  AppSecurityDto, ArsSettingsDto, AttestRegisterDto, AuthLogDto, ClientDto, CreateSessionDto, ImportPoolDto, PbxVerifyDto, PcCodeDto,
  SessionRefDto, VnStatusDto,
} from './ars-engine.dto';
import { IntegrityService } from './integrity/integrity.service';
import { NumberPoolService } from './number-pool.service';

function identity(dto: ClientDto, req: Request): ClientIdentity {
  const auth = req.header('authorization');
  return {
    api_key: dto.api_key ?? (auth?.startsWith('Bearer ') ? auth.slice(7) : undefined),
    mobile_app_name: dto.mobile_app_name,
    client_platform: dto.client_platform,
    package_name: dto.package_name,
    bundle_id: dto.bundle_id,
  };
}

/** Customer-facing ARS API used by the mobile SDK / customer servers. */
@ApiTags('ars')
@Controller('v1/ars')
export class ArsApiController {
  constructor(private readonly auth: ApiKeyAuthService, private readonly sessions: ArsSessionService, private readonly integrity: IntegrityService) {}

  @Post('integrity/challenge')
  @HttpCode(200)
  async challenge(@Body() dto: ClientDto, @Req() req: Request) {
    const c = await this.auth.verify(identity(dto, req), getClientIp(req));
    return this.integrity.challenge(c.apiKeyId, c.app.id);
  }

  @Post('integrity/ios/attest')
  @HttpCode(200)
  async attest(@Body() dto: AttestRegisterDto, @Req() req: Request) {
    const c = await this.auth.verify(identity(dto, req), getClientIp(req));
    return this.integrity.registerAttestKey(c.app, c.apiKeyId, dto);
  }

  @Post('sessions')
  async create(@Body() dto: CreateSessionDto, @Req() req: Request) {
    const c = await this.auth.verify(identity(dto, req), getClientIp(req));
    return this.sessions.create(c, dto);
  }

  @Post('sessions/status')
  @HttpCode(200)
  async status(@Body() dto: SessionRefDto, @Req() req: Request) {
    const c = await this.auth.verify(identity(dto, req), getClientIp(req));
    return this.sessions.status(c, dto.session_id);
  }

  @Post('sessions/cancel')
  @HttpCode(200)
  async cancel(@Body() dto: SessionRefDto, @Req() req: Request) {
    const c = await this.auth.verify(identity(dto, req), getClientIp(req));
    return this.sessions.cancel(c, dto.session_id);
  }

  @Post('sessions/pc-code')
  @HttpCode(200)
  async pcCode(@Body() dto: PcCodeDto, @Req() req: Request) {
    const c = await this.auth.verify(identity(dto, req), getClientIp(req));
    return this.sessions.submitPcCode(c, dto.session_id, dto.code);
  }
}

/** Loopback-only endpoints for the Asterisk dialplan (CURL) and the Daou AuthLog receiver. */
@Controller('internal')
export class ArsInternalController {
  constructor(private readonly sessions: ArsSessionService) {}

  private guard(req: Request) {
    const ip = (req.socket.remoteAddress ?? '').replace('::ffff:', '');
    const key = process.env.INTERNAL_API_KEY ?? '';
    const given = req.header('x-internal-key') ?? String((req.body as Record<string, unknown>)?.key ?? '');
    const ok = key.length >= 32 && given.length === key.length && timingSafeEqual(Buffer.from(given), Buffer.from(key));
    const loop = ip === '127.0.0.1' || ip === '::1' || (process.env.INTERNAL_ALLOWED_IPS ?? '').split(',').includes(ip);
    if (!ok || !loop) throw new ForbiddenException('FORBIDDEN');
  }

  /** Returns plain text for the dialplan: "OK", "OK:47" (PC code to read out) or "FAIL:reason". */
  @Post('pbx/verify')
  @HttpCode(200)
  async verify(@Body() dto: PbxVerifyDto & { key?: string }, @Req() req: Request, @Res() res: Response) {
    this.guard(req);
    const t0 = dto.t0 ? new Date(Number(dto.t0) * 1000) : new Date();
    const v = await this.sessions.verifyCall({ rn: dto.rn, caller: dto.caller ?? '', uniqueId: dto.uid, t0: Math.abs(t0.getTime() - Date.now()) < 600_000 ? t0 : new Date(), confirmKey: dto.confirm });
    res.type('text/plain').send(v.result === 'OK' ? (v.pcCode ? `OK:${v.pcCode}` : 'OK') : `FAIL:${v.reason}`);
  }

  @Post('authlog')
  @HttpCode(200)
  async authlog(@Body() dto: AuthLogDto & { key?: string }, @Req() req: Request) {
    this.guard(req);
    return this.sessions.recordAuthLog({ vn: dto.vn, an: dto.an ?? '', callStartTime: dto.callStartTime, callId: dto.callId });
  }
}

/** Admin console API for the number pool, settings, sessions and per-app security. */
@ApiTags('admin-ars')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/admin/ars')
export class ArsAdminController {
  constructor(private readonly pool: NumberPoolService, private readonly settings: ArsSettingsService, private readonly prisma: PrismaService,
    private readonly sessionsSvc: ArsSessionService) {}

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('pool/summary')
  summary() { return this.pool.summary(); }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('pool')
  list(@Query('q') q?: string, @Query('status') status?: string, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.pool.list({ q, status, skip: Number(skip ?? 0), take: Number(take ?? 100) });
  }

  @Roles('SUPER_ADMIN')
  @Post('pool/import')
  async import(@Body() dto: ImportPoolDto, @Req() req: AuthenticatedRequest) {
    const r = await this.pool.importInventory(dto.numbers, dto.lines, { remapRn: dto.remap_rn });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: req.user!.id, action: 'VN_IMPORT', targetType: 'VIRTUAL_NUMBER', details: r } });
    return r;
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Patch('pool/:id')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: VnStatusDto, @Req() req: AuthenticatedRequest) {
    return this.pool.setStatus(id, dto.status, req.user!.id);
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('settings')
  getSettings() { return this.settings.get(); }

  @Roles('SUPER_ADMIN')
  @Patch('settings')
  setSettings(@Body() dto: ArsSettingsDto, @Req() req: AuthenticatedRequest) { return this.settings.update(dto, req.user!.id); }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('sessions')
  async sessions(@Query('status') status?: string, @Query('take') take?: string) {
    const items = await this.prisma.arsSession.findMany({
      where: status ? { status: status as never } : {}, orderBy: { createdAt: 'desc' }, take: Math.min(Number(take ?? 100), 500),
      select: { sessionId: true, mobileAppName: true, clientPlatform: true, mode: true, purpose: true, vn: true, rn: true, status: true, failReason: true,
        callerPhoneMasked: true, integrityVerdict: true, createdAt: true, finishedAt: true, expiresAt: true },
    });
    return { items };
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('calls')
  calls(@Query('take') take?: string) {
    return this.prisma.pbxCall.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Number(take ?? 100), 500),
      select: { uniqueId: true, rn: true, callerMasked: true, startedAt: true, result: true, reason: true, sessionId: true } });
  }

  // ------------------------------------------------------------- admin test console
  private async testClient() {
    // A built-in, admin-only application used by the console's live call test (no API key is ever issued for it).
    let app = await this.prisma.applicationApp.findFirst({ where: { mobileAppName: 'ARS2FA-ADMIN-TEST' }, include: { application: { include: { apiKeys: true } } } });
    if (!app) {
      const user = await this.prisma.user.upsert({ where: { email: 'admin-test@ars2fa.local' }, update: {},
        create: { email: 'admin-test@ars2fa.local', passwordHash: '!', companyName: 'ars2fa', contactName: '관리자 시험', contactPhone: '00000000000', status: 'SUSPENDED' } });
      const application = await this.prisma.apiApplication.create({ data: { userId: user.id, serviceName: '관리자 실통화 시험', usagePurpose: 'admin console test', expectedMonthlyRequests: 0, status: 'APPROVED' } });
      await this.prisma.applicationApp.create({ data: { applicationId: application.id, mobileAppName: 'ARS2FA-ADMIN-TEST', displayName: 'ars2fa 시험', platform: 'ANDROID', status: 'APPROVED', integrityPolicy: 'OFF' } });
      await this.prisma.apiKey.create({ data: { applicationId: application.id, keyPrefix: 'admin-test', keyHash: `admin-test-${randomBytes(16).toString('hex')}`, status: 'ACTIVE', monthlyLimit: 100000 } });
      app = await this.prisma.applicationApp.findFirst({ where: { mobileAppName: 'ARS2FA-ADMIN-TEST' }, include: { application: { include: { apiKeys: true } } } });
    }
    return { apiKeyId: app!.application.apiKeys[0].id, app: app! };
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Post('test/sessions')
  async testCreate(@Body() dto: { mode?: 'APP' | 'PC'; expected_phone?: string }) {
    const c = await this.testClient();
    return this.sessionsSvc.create(c, { mode: dto?.mode === 'PC' ? 'PC' : 'APP', purpose: '관리자 시험', expected_phone: dto?.expected_phone || undefined });
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('test/sessions/:sid')
  async testStatus(@Param('sid') sid: string) {
    return this.sessionsSvc.status(await this.testClient(), sid);
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Post('test/sessions/:sid/pc-code')
  async testPcCode(@Param('sid') sid: string, @Body() dto: { code?: string }) {
    return this.sessionsSvc.submitPcCode(await this.testClient(), sid, String(dto?.code ?? ''));
  }

  @Roles('REVIEWER', 'SUPER_ADMIN')
  @Get('apps')
  apps() {
    return this.prisma.applicationApp.findMany({ orderBy: { createdAt: 'desc' }, include: { application: { select: { serviceName: true, status: true, user: { select: { companyName: true } } } } } });
  }

  @Roles('REVIEWER', 'SUPER_ADMIN')
  @Patch('apps/:id/security')
  async appSecurity(@Param('id') id: string, @Body() dto: AppSecurityDto, @Req() req: AuthenticatedRequest) {
    const app = await this.prisma.applicationApp.update({ where: { id }, data: {
      integrityPolicy: dto.integrityPolicy, displayName: dto.displayName, androidCertSha256: dto.androidCertSha256, iosTeamId: dto.iosTeamId || undefined } });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: req.user!.id, action: 'APP_SECURITY_UPDATE', targetType: 'APPLICATION_APP', targetId: id, details: { ...dto } } });
    return app;
  }
}
