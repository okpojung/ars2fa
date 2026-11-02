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
  AppSecurityDto, ArsSettingsDto, AttestRegisterDto, AuthLogDto, ClientDto, CreateSessionDto, ImportPoolDto, PbxCodeDto, PbxHangupDto, PbxPrecheckDto, PbxVerifyDto,
  SessionRefDto, VnStatusDto,
} from './ars-engine.dto';
import { IntegrityService } from './integrity/integrity.service';
import { NumberPoolService } from './number-pool.service';
import { WidgetService } from './widget.service';
import { TrunkMonitorService } from './trunk-monitor.service';
import { cleanReportedInfo, describeRequest } from './client-info.util';

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
    const r = await this.sessions.create(c, dto);
    await this.sessions.attachStarter(r.session_id, describeRequest(req));
    return r;
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
}

/** Public mobile page data for the PC-mode QR (one-time token, no login). */
@ApiTags('ars-public')
@Controller('api/public/ars')
export class ArsPublicController {
  constructor(private readonly sessions: ArsSessionService) {}

  @Get('dial/:token')
  async dial(@Param('token') token: string, @Req() req: Request) {
    await this.sessions.recordMobile(token, describeRequest(req));
    return this.sessions.dialPage(token);
  }

  /** The QR page reports what it can see about the phone (screen, timezone, model via UA client hints). */
  @Post('dial/:token/device')
  @HttpCode(204)
  async device(@Param('token') token: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    await this.sessions.recordMobile(token, describeRequest(req), cleanReportedInfo(body));
  }
}

/** Loopback-only endpoints for the Asterisk dialplan (CURL) and the Daou AuthLog receiver. */
@Controller('internal')
export class ArsInternalController {
  constructor(private readonly sessions: ArsSessionService, private readonly trunk: TrunkMonitorService) {}

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
    res.type('text/plain').send(v.result === 'OK' ? (v.pcCode ? `OK:${v.pcCode}` : 'OK') : v.result === 'WAIT' ? 'FAIL:no_authlog' : `FAIL:${v.reason}`);
  }

  /** "OK" if an authentication is waiting for a call on this 070, otherwise "NO" (PBX plays the invalid-access message). */
  @Post('pbx/precheck')
  @HttpCode(200)
  async precheck(@Body() dto: PbxPrecheckDto, @Req() req: Request, @Res() res: Response) {
    this.guard(req);
    res.type('text/plain').send((await this.sessions.precheck(dto.rn, dto.uid, dto.caller)) ? 'OK' : 'NO');
  }

  /**
   * Right after answering: "APP" (play notice + confirm key, then pbx/verify), "PC:<digits>:<readTimeout>"
   * (play guidance and read the code shown on the PC, then pbx/code) or "FAIL:<reason>".
   */
  @Post('pbx/connect')
  @HttpCode(200)
  async connect(@Body() dto: PbxVerifyDto & { key?: string }, @Req() req: Request, @Res() res: Response) {
    this.guard(req);
    const t0 = dto.t0 ? new Date(Number(dto.t0) * 1000) : new Date();
    const v = await this.sessions.verifyCall({ rn: dto.rn, caller: dto.caller ?? '', uniqueId: dto.uid,
      t0: Math.abs(t0.getTime() - Date.now()) < 600_000 ? t0 : new Date(), phase: 'connect', waitSeconds: dto.wait != null ? Number(dto.wait) : undefined });
    if (v.result === 'WAIT') { res.type('text/plain').send('WAIT'); return; }
    res.type('text/plain').send(v.result !== 'OK' ? `FAIL:${v.reason}` : v.mode === 'PC' ? `PC:${v.digits}:${v.readTimeout}` : v.confirm === false ? 'APPN' : 'APP');
  }

  /** PC mode: the digits the caller keyed in. "OK" or "FAIL:<reason>". */
  @Post('pbx/code')
  @HttpCode(200)
  async code(@Body() dto: PbxCodeDto, @Req() req: Request, @Res() res: Response) {
    this.guard(req);
    const v = await this.sessions.submitPhoneCode(dto.uid, dto.code ?? '');
    res.type('text/plain').send(v.result === 'OK' ? 'OK' : `FAIL:${v.reason}`);
  }

  /** Hangup notice from the dialplan (h extension): switch the number's forwarding off now. */
  @Post('pbx/hangup')
  @HttpCode(200)
  async hangup(@Body() dto: PbxHangupDto, @Req() req: Request, @Res() res: Response) {
    this.guard(req);
    await this.sessions.callEnded(dto.uid);
    res.type('text/plain').send('OK');
  }

  /** Concurrent call sample from the PBX host monitor (every few seconds): current and peak since the last post. */
  @Post('pbx/trunk')
  @HttpCode(200)
  async trunkSample(@Body() body: { trunk?: number; total?: number; trunkPeak?: number; totalPeak?: number; maxcalls?: number }, @Req() req: Request) {
    this.guard(req);
    await this.trunk.record({ trunk: Number(body.trunk), total: Number(body.total), trunkPeak: Number(body.trunkPeak), totalPeak: Number(body.totalPeak), maxcalls: body.maxcalls == null ? null : Number(body.maxcalls) });
    return { ok: true };
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
    private readonly sessionsSvc: ArsSessionService, private readonly widget: WidgetService) {}

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('pool/summary')
  summary() { return this.pool.summary(); }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('pool')
  list(@Query('q') q?: string, @Query('status') status?: string, @Query('sort') sort?: string, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.pool.list({ q, status, sort, skip: Number(skip ?? 0), take: Number(take ?? 100) });
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
  async setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: VnStatusDto, @Req() req: AuthenticatedRequest) {
    if (dto.routing) {
      const r = await this.prisma.virtualNumber.update({ where: { id }, data: { routing: dto.routing } });
      await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: req.user!.id, action: `VN_ROUTING_${dto.routing}`, targetType: 'VIRTUAL_NUMBER', targetId: String(id), details: { vn: r.vn } } });
    }
    return dto.status ? this.pool.setStatus(id, dto.status, req.user!.id) : this.prisma.virtualNumber.findUniqueOrThrow({ where: { id } });
  }

  /** Switch a number's CallMix forwarding off right away (also clears a stuck UNKNOWN state once it succeeds). */
  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Post('pool/:id/unlink')
  async forceUnlink(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    const cur = await this.prisma.virtualNumber.findUniqueOrThrow({ where: { id } });
    if (cur.routing !== 'DYNAMIC') throw new ForbiddenException('STATIC_NUMBER');
    const n = await this.prisma.virtualNumber.update({ where: { id }, data: { linkState: 'UNKNOWN', unlinkAfter: new Date() } });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: req.user!.id, action: 'VN_FORCE_UNLINK', targetType: 'VIRTUAL_NUMBER', targetId: String(id), details: { vn: n.vn } } });
    return { ok: true };
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('carrier/calls')
  carrierCalls(@Query('take') take?: string, @Query('failed') failed?: string) {
    return this.prisma.carrierCall.findMany({ where: failed === '1' ? { ok: false } : {}, orderBy: { createdAt: 'desc' }, take: Math.min(Number(take ?? 100), 500) });
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
        callerPhoneMasked: true, integrityVerdict: true, createdAt: true, finishedAt: true, expiresAt: true, pcClient: true, mobileClient: true, widgetOrigin: true },
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
  async testCreate(@Body() dto: { mode?: 'APP' | 'PC'; expected_phone?: string; country_code?: string }) {
    const c = await this.testClient();
    return this.sessionsSvc.create(c, { mode: dto?.mode === 'PC' ? 'PC' : 'APP', purpose: '관리자 시험', expected_phone: dto?.expected_phone || undefined,
      country_code: dto?.country_code || undefined });
  }

  /** Admin live test, PC mode in the popup (same page the widget uses). */
  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Post('test/popup')
  async testPopup(@Body() dto: { country_code?: string; expected_phone?: string }, @Req() req: Request) {
    const c = await this.testClient();
    return this.widget.startForClient(c, { origin: this.widget.ownOrigin(req.header('origin')), ip: getClientIp(req), phone: String(dto?.expected_phone ?? ''), countryCode: dto?.country_code, purpose: '관리자 시험', clientInfo: describeRequest(req) });
  }

  /** Admin console demo of the web widget: a WEB app under the built-in test application (allowed: this site). */
  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('test/widget-site')
  async testWidgetSite() {
    const c = await this.testClient();
    const origins = ['https://ars2fa.baro.me', 'https://192.168.94.180:9446'].join(',');
    let web = await this.prisma.applicationApp.findFirst({ where: { applicationId: c.app.applicationId, platform: 'WEB' } });
    if (!web) web = await this.prisma.applicationApp.create({ data: { applicationId: c.app.applicationId, mobileAppName: 'ARS2FA-WIDGET-TEST', displayName: 'ars2fa 위젯 시험',
      platform: 'WEB', status: 'APPROVED', integrityPolicy: 'OFF', allowedOrigins: origins, siteKey: `pk_${randomBytes(18).toString('base64url')}` } });
    return { siteKey: web.siteKey };
  }

  /** Admin demo: the server-side check a customer does with its secret key (here: the test application's key). */
  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Post('test/widget-verify')
  async testWidgetVerify(@Body() dto: { session_id?: string; consume?: boolean }) {
    const c = await this.testClient();
    return this.widget.verifyForKey(c.apiKeyId, String(dto?.session_id ?? ''), dto?.consume === true);
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('test/sessions/:sid')
  async testStatus(@Param('sid') sid: string) {
    return this.sessionsSvc.status(await this.testClient(), sid);
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
