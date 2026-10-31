import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ArsSession, ArsSessionMode, ArsSessionStatus, Prisma } from '@prisma/client';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ArsSettingsService } from './ars-settings.service';
import { IntegrityInput, IntegrityService } from './integrity/integrity.service';
import { LeasedNumber, NumberPoolService } from './number-pool.service';
import { CarrierService } from './carrier.service';
import { isHiddenCaller, isKrMobile, maskPhone, normalizeKrPhone, openText, phoneHash, sealText, valueHash } from './phone.util';
import { VerifiedClient } from './api-key-auth.service';

/** Result line returned to the PBX dialplan. */
export type PbxVerdict = { result: 'OK' | 'FAIL'; reason?: string; pcCode?: string; sessionId?: string; mode?: 'APP' | 'PC'; digits?: number; readTimeout?: number };

/** Time slack between Daou's callStartTime and our INVITE time (measured INVITE->AuthLog 1-2 s). */
const AUTHLOG_BEFORE_MS = 20_000;
const AUTHLOG_AFTER_MS = 10_000;
/** A call placed just before the window closes is still being handled (notice, press 1) this long after it. */
export const CALL_GRACE_MS = 20_000;
/** While a call is in progress the forwarding stays on at most this long (the PBX hangup notice usually ends it sooner). */
export const IN_CALL_UNLINK_MS = 20_000;
/** How many numbers to try when CallMix refuses to switch one on. */
const LINK_ATTEMPTS = 3;

/** POST /v1/ars/sessions response. APP: dial_number/dial_uri (dialled by the app, never shown). PC: dial_page_url (QR). */
export type CreateSessionResult = {
  session_id: string; status: string; mode: ArsSessionMode; dial_number?: string; dial_uri?: string; dial_page_url?: string;
  expires_at: string; expires_in: number; display_name: string; integrity: string; notice: string;
};
export type DialPageInfo = { state: 'READY' | 'CONNECTED' | 'DONE' | 'EXPIRED' | 'CLOSED' | 'NOT_FOUND'; display_name?: string; expires_at?: string; tel?: string };

export const FAIL_REASONS = [
  'hidden_caller', 'not_mobile', 'not_confirmed', 'no_authlog', 'no_session', 'multiple_calls',
  'second_call', 'phone_mismatch', 'pc_code_wrong', 'code_timeout', 'timeout', 'canceled_by_client', 'pool_mismatch', 'invalid_access',
] as const;

/** Length of the ARS guidance played (as Read prompt) before/while the caller keys in the PC code. */
const PC_GUIDE_SECONDS = 5;

@Injectable()
export class ArsSessionService {
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: NumberPoolService,
    private readonly settings: ArsSettingsService,
    private readonly integrity: IntegrityService,
    private readonly carrier: CarrierService,
  ) {}

  /**
   * Leases the next number of the random cycle and, for DYNAMIC numbers, switches its CallMix forwarding on.
   * The number is handed out only after the carrier confirmed; refused numbers rest and the next one is tried.
   */
  private async leaseAndLink(ttlSeconds: number, cooldownSeconds: number): Promise<{ leased: LeasedNumber; expiresAt: Date }> {
    let lastError = '';
    for (let i = 0; i < LINK_ATTEMPTS; i++) {
      const t = this.now();
      const leased = await this.pool.lease(new Date(t.getTime() + (ttlSeconds + 60) * 1000), t, { dynamic: this.carrier.enabled });
      if (leased.routing === 'STATIC') {
        const expiresAt = new Date(this.now().getTime() + ttlSeconds * 1000);
        return { leased, expiresAt };
      }
      const r = await this.carrier.set(leased.vnId, leased.vn, leased.rn, true);
      if (r.ok) {
        // the call window starts when the forwarding is actually on
        const now = this.now();
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
        await this.pool.markLinked(leased.vnId, new Date(expiresAt.getTime() + CALL_GRACE_MS), expiresAt, now);
        return { leased, expiresAt };
      }
      lastError = `${r.code} ${r.message}`;
      await this.pool.linkFailed(leased.vnId, lastError, cooldownSeconds, this.now());
    }
    throw new HttpException({ code: 'CARRIER_UNAVAILABLE', message: '인증 번호를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }

  // ---------------------------------------------------------------------------------------------
  // customer API
  // ---------------------------------------------------------------------------------------------

  async create(client: VerifiedClient, body: IntegrityInput & {
    mode?: ArsSessionMode; appsid?: string; purpose?: string; expected_phone?: string; country_code?: string;
  }): Promise<CreateSessionResult> {
    const s = await this.settings.get();
    const mode: ArsSessionMode = body.mode === 'PC' ? 'PC' : 'APP';
    let expectedHash: string | null = null;
    const cc = (body.country_code ?? '82').replace(/\D/g, '');
    if (cc !== '82') throw new BadRequestException('UNSUPPORTED_COUNTRY_CODE');
    // PC mode authenticates a given phone: the number typed on the PC must be the one that calls
    if (mode === 'PC' && !body.expected_phone) throw new BadRequestException('EXPECTED_PHONE_REQUIRED');
    if (body.expected_phone) {
      const p = normalizeKrPhone(body.expected_phone);
      if (!p || (s.mobileOnly && !isKrMobile(p))) throw new BadRequestException('INVALID_EXPECTED_PHONE');
      expectedHash = phoneHash(p);
    }
    if (body.purpose && (body.purpose.length > 40 || !/^[\p{L}\p{N} _.\-]*$/u.test(body.purpose))) throw new BadRequestException('INVALID_PURPOSE');

    // App forgery check happens before a number is leased (ENFORCE refuses here).
    const integrity = await this.integrity.evaluate(client.app, client.apiKeyId, body);

    const ttl = mode === 'PC' ? s.leaseSecondsPc : s.leaseSecondsApp;
    // forwarding on only for this session; switched off at expiresAt or when the call is over
    const { leased, expiresAt } = await this.leaseAndLink(ttl, s.cooldownSeconds);
    const sessionId = `ars_${randomBytes(15).toString('base64url')}`;
    // PC mode: code shown on the PC once the call is connected, keyed in on the phone; QR opens a one-time dial page
    const pcCode = mode === 'PC' ? Array.from({ length: s.pcCodeDigits }, () => String(randomInt(10))).join('') : null;
    const dialToken = mode === 'PC' ? randomBytes(18).toString('base64url') : null;
    const session = await this.prisma.arsSession.create({
      data: {
        sessionId, apiKeyId: client.apiKeyId, applicationAppId: client.app.id, mobileAppName: client.app.mobileAppName,
        displayName: client.app.displayName || client.app.mobileAppName, clientPlatform: client.app.platform, mode,
        appsid: body.appsid?.slice(0, 100), purpose: body.purpose ?? null, vnId: leased.vnId, vn: leased.vn, rn: leased.rn,
        expectedPhoneHash: expectedHash, pcCode, dialToken, integrityVerdict: integrity.verdict, integrityDetail: integrity.detail as Prisma.InputJsonValue, expiresAt,
      },
    });
    await this.event(session.id, 'SESSION_CREATED', { mode, cycle: leased.cycleNo, position: leased.position, routing: leased.routing, integrity: integrity.verdict });
    const dial = this.dialString(leased.vn);
    const base = (process.env.PUBLIC_DIAL_BASE_URL ?? process.env.APP_URL ?? '').replace(/\/+$/, '');
    return {
      session_id: session.sessionId,
      status: session.status,
      mode,
      // APP: the app dials this itself; it must not be printed on screen (see SDK guide).
      // PC: the number is never given to the PC; the QR carries dial_page_url, a one-time mobile page with a call button.
      ...(mode === 'PC' ? { dial_page_url: `${base}/m/ars/${dialToken}` } : { dial_number: dial, dial_uri: `tel:${dial}` }),
      expires_at: expiresAt.toISOString(),
      expires_in: ttl,
      display_name: session.displayName,
      integrity: integrity.verdict,
      notice: `${session.displayName} 인증 전화입니다. 본인이 요청하지 않았다면 전화를 끊으세요.`,
    };
  }

  dialString(vn: string) {
    return vn.length === 12 ? `${vn.slice(0, 4)}-${vn.slice(4, 8)}-${vn.slice(8)}` : vn;
  }

  async status(client: VerifiedClient, sessionId: string) {
    await this.expireDue();
    const s = await this.find(client, sessionId);
    const out: Record<string, unknown> = {
      session_id: s.sessionId, status: s.status, fail_reason: s.failReason, mode: s.mode,
      expires_at: s.expiresAt.toISOString(), finished_at: s.finishedAt?.toISOString() ?? null,
      phone_masked: s.callerPhoneMasked, integrity: s.integrityVerdict,
      pc_code_required: s.status === 'CALL_CONFIRMED',
    };
    // PC mode: once the call is connected the PC shows the code to key in on the phone, with its deadline
    if (s.mode === 'PC' && s.status === 'CALL_CONFIRMED') Object.assign(out, { pc_code: s.pcCode, code_expires_at: s.codeExpiresAt?.toISOString() ?? null, code_seconds: (await this.settings.get()).pcCodeSeconds });
    if (s.status === 'VERIFIED' && s.callerPhoneEnc) out.phone = openText(s.callerPhoneEnc);
    return out;
  }

  async cancel(client: VerifiedClient, sessionId: string) {
    const s = await this.find(client, sessionId);
    if (s.status !== 'PENDING' && s.status !== 'CALL_CONFIRMED') throw new ConflictException('SESSION_NOT_ACTIVE');
    await this.finish(s, 'CANCELED', 'canceled_by_client');
    return this.status(client, sessionId);
  }

  /** Mobile dial page (QR, PC mode): call button while the window is open. Public, addressed by an unguessable one-time token. */
  async dialPage(token: string): Promise<DialPageInfo> {
    const s = token && /^[A-Za-z0-9_-]{20,40}$/.test(token) ? await this.prisma.arsSession.findUnique({ where: { dialToken: token } }) : null;
    if (!s) return { state: 'NOT_FOUND' };
    const open = s.status === 'PENDING' && s.expiresAt.getTime() > this.now().getTime();
    const state: DialPageInfo['state'] = open ? 'READY' : s.status === 'CALL_CONFIRMED' ? 'CONNECTED' : s.status === 'VERIFIED' ? 'DONE' : s.status === 'PENDING' ? 'EXPIRED' : 'CLOSED';
    return { state, display_name: s.displayName, expires_at: s.expiresAt.toISOString(), ...(open ? { tel: `tel:${this.dialString(s.vn)}` } : {}) };
  }
  private async find(client: VerifiedClient, sessionId: string) {
    const s = await this.prisma.arsSession.findUnique({ where: { sessionId } });
    if (!s || s.apiKeyId !== client.apiKeyId) throw new NotFoundException('SESSION_NOT_FOUND');
    return s;
  }

  // ---------------------------------------------------------------------------------------------
  // carrier AuthLog and PBX
  // ---------------------------------------------------------------------------------------------

  /** Stores a Daou AuthLog (already authenticated by the receiver). Idempotent on callId. */
  async recordAuthLog(input: { vn: string; an: string; callStartTime: string; callId: string }) {
    const vn = (input.vn ?? '').replace(/\D/g, '');
    const an = normalizeKrPhone(input.an);
    const t = parseKstDateTime(input.callStartTime);
    if (!vn || !t || !input.callId) throw new BadRequestException('INVALID_AUTHLOG');
    const callIdHash = valueHash('callid', String(input.callId));
    const ev = await this.prisma.authLogEvent.upsert({
      where: { callIdHash },
      update: {},
      create: { vn, anHash: an ? phoneHash(an) : null, anMasked: maskPhone(an), callStartAt: t, callIdHash },
    });
    // A call to a number whose session already succeeded is recorded for monitoring.
    const late = await this.prisma.arsSession.findFirst({ where: { vn, status: 'VERIFIED', createdAt: { lte: t }, expiresAt: { gte: new Date(t.getTime() - AUTHLOG_AFTER_MS) } } });
    if (late && late.authlogEventId && late.authlogEventId !== ev.id) await this.event(late.id, 'LATE_CALL_AFTER_SUCCESS', { anMasked: ev.anMasked });
    return { ok: true };
  }

  /**
   * Called by the PBX after the phishing notice. Decides the call:
   * 1) caller id shown, 2) caller pressed the confirm key, 3) carrier AuthLog exists for this caller on a
   * 0507 that forwards to this 070, 4) that 0507 is leased to a pending session, 5) it is the only call
   * to that number in the session, 6) expected phone (if given) matches.
   */
  /**
   * Answered call, before the notice: is any authentication waiting for a call on this 070 right now?
   * If not, the call is not part of an authentication and the PBX plays the "not a valid access" message.
   */
  async precheck(rnRaw: string, uniqueId?: string, callerRaw?: string): Promise<boolean> {
    const rn = (rnRaw ?? '').replace(/\D/g, '').replace(/^82/, '0');
    const n = rn ? await this.prisma.arsSession.count({ where: { rn, status: 'PENDING', expiresAt: { gte: new Date(this.now().getTime() - CALL_GRACE_MS) } } }) : 0;
    if (n === 0 && uniqueId) {
      // not part of any authentication (resting number on the guard line, late or repeated call): recorded for monitoring
      const caller = normalizeKrPhone(callerRaw);
      await this.prisma.pbxCall.upsert({ where: { uniqueId: uniqueId.slice(0, 64) }, update: {},
        create: { uniqueId: uniqueId.slice(0, 64), rn, callerHash: caller ? phoneHash(caller) : null, callerMasked: maskPhone(caller), startedAt: this.now(), result: 'FAIL', reason: 'invalid_access' } }).catch(() => undefined);
    }
    return n > 0;
  }

  /** PBX hangup notice: the call is over, so the forwarding of its number can be switched off now. */
  async callEnded(uniqueId: string) {
    const call = await this.prisma.pbxCall.findUnique({ where: { uniqueId: (uniqueId ?? '').slice(0, 64) } });
    if (!call) return { ok: true };
    await this.prisma.pbxCall.update({ where: { id: call.id }, data: { endedAt: this.now() } });
    if (call.sessionId) {
      const s = await this.prisma.arsSession.findUnique({ where: { sessionId: call.sessionId } });
      if (s) await this.pool.scheduleUnlink(s.vnId, this.now());
    }
    return { ok: true };
  }

  /**
   * phase 'connect' (right after the call is answered): identifies the session from the carrier AuthLog and runs every
   * check that does not need caller input. Passing calls switch the number's forwarding off at once. APP sessions then
   * get the notice + confirm key (phase 'verify'); PC sessions move to CALL_CONFIRMED and the PC shows the code.
   * phase 'verify' (APP, after the confirm key): decides the call.
   */
  async verifyCall(input: { rn: string; caller: string; uniqueId: string; t0: Date; confirmKey?: string; phase?: 'connect' | 'verify' }): Promise<PbxVerdict> {
    const phase = input.phase ?? 'verify';
    const s = await this.settings.get();
    const rn = (input.rn ?? '').replace(/\D/g, '').replace(/^82/, '0');
    const caller = normalizeKrPhone(input.caller);
    const call = await this.prisma.pbxCall.upsert({
      where: { uniqueId: input.uniqueId.slice(0, 64) },
      update: {},
      create: { uniqueId: input.uniqueId.slice(0, 64), rn, callerHash: caller ? phoneHash(caller) : null, callerMasked: maskPhone(caller), startedAt: input.t0 },
    });
    const done = async (v: PbxVerdict) => {
      await this.prisma.pbxCall.update({ where: { id: call.id }, data: { result: v.result, reason: v.reason ?? null, sessionId: v.sessionId ?? null } });
      return v;
    };
    // once a call for a session has been decided, its number stops taking calls shortly after (or at hangup)
    const stopSoon = (vnId: number) => this.pool.scheduleUnlink(vnId, new Date(this.now().getTime() + IN_CALL_UNLINK_MS));
    if (isHiddenCaller(input.caller) || !caller) return done({ result: 'FAIL', reason: 'hidden_caller' });
    if (s.mobileOnly && !isKrMobile(caller)) return done({ result: 'FAIL', reason: 'not_mobile' });

    // carrier AuthLog for this caller on a number forwarded to this line
    const callerHash = phoneHash(caller);
    const from = new Date(input.t0.getTime() - AUTHLOG_BEFORE_MS);
    const to = new Date(input.t0.getTime() + AUTHLOG_AFTER_MS);
    const deadline = Date.now() + s.authlogWaitSeconds * 1000;
    let log: { id: string; vn: string; callStartAt: Date } | null = null;
    for (;;) {
      const rows = await this.prisma.$queryRaw<{ id: string; vn: string; callStartAt: Date }[]>`
        SELECT e.id, e.vn, e."callStartAt" FROM "AuthLogEvent" e JOIN "VirtualNumber" v ON v.vn = e.vn
        WHERE v.rn = ${rn} AND e."anHash" = ${callerHash} AND e."callStartAt" BETWEEN ${from} AND ${to}
        ORDER BY e."callStartAt" DESC LIMIT 1`;
      if (rows.length) { log = rows[0]; break; }
      if (Date.now() >= deadline) break;
      await this.sleep(250);
    }

    // the session is identified by the 0507 the carrier saw; without AuthLog we cannot (and must not) trust the call
    if (!log) {
      // still fail the session this caller was probably trying, if it is unambiguous on this line
      return done({ result: 'FAIL', reason: 'no_authlog' });
    }
    const session = await this.prisma.arsSession.findFirst({
      where: { vn: log.vn, status: { in: ['PENDING', 'CALL_CONFIRMED', 'VERIFIED', 'FAILED'] }, createdAt: { lte: new Date(log.callStartAt.getTime() + 5000) },
        expiresAt: { gte: new Date(log.callStartAt.getTime() - 5000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return done({ result: 'FAIL', reason: 'no_session' });
    if (session.rn !== rn) return done({ result: 'FAIL', reason: 'pool_mismatch', sessionId: session.sessionId });
    if (phase === 'verify') await stopSoon(session.vnId);
    if (session.status !== 'PENDING') {
      // a second call to an already decided session: never changes the outcome
      await this.event(session.id, 'EXTRA_CALL_REJECTED', { callerMasked: maskPhone(caller) });
      return done({ result: 'FAIL', reason: 'second_call', sessionId: session.sessionId });
    }
    if (phase === 'connect') return done(await this.connectChecks(session, log, { callerHash, caller, uniqueId: call.uniqueId }, s));
    if (session.mode === 'PC') return done({ result: 'FAIL', reason: 'not_confirmed', sessionId: session.sessionId });
    if (s.confirmKeyRequired && input.confirmKey !== '1') {
      await this.finish(session, 'FAILED', 'not_confirmed', { callerHash, caller, uniqueId: call.uniqueId, logId: log.id, at: log.callStartAt });
      return done({ result: 'FAIL', reason: 'not_confirmed', sessionId: session.sessionId });
    }
    // exactly one carrier-logged call to this number during the session
    const calls = await this.prisma.authLogEvent.count({ where: { vn: log.vn, callStartAt: { gte: new Date(session.createdAt.getTime() - 5000), lte: new Date(Math.max(this.now().getTime(), log.callStartAt.getTime())) } } });
    if (calls !== 1) {
      await this.finish(session, 'FAILED', 'multiple_calls', { callerHash, caller, uniqueId: call.uniqueId, logId: log.id, at: log.callStartAt });
      return done({ result: 'FAIL', reason: 'multiple_calls', sessionId: session.sessionId });
    }
    if (session.expectedPhoneHash && session.expectedPhoneHash !== callerHash) {
      await this.finish(session, 'FAILED', 'phone_mismatch', { callerHash, caller, uniqueId: call.uniqueId, logId: log.id, at: log.callStartAt });
      return done({ result: 'FAIL', reason: 'phone_mismatch', sessionId: session.sessionId });
    }
    const callData = { callerHash, caller, uniqueId: call.uniqueId, logId: log.id, at: log.callStartAt };
    const ok = await this.finish(session, 'VERIFIED', null, callData);
    return done(ok ? { result: 'OK', sessionId: session.sessionId } : { result: 'FAIL', reason: 'second_call', sessionId: session.sessionId });
  }

  private async connectChecks(session: ArsSession, log: { id: string; vn: string; callStartAt: Date },
    who: { callerHash: string; caller: string; uniqueId: string }, s: Awaited<ReturnType<ArsSettingsService['get']>>): Promise<PbxVerdict> {
    const callData = { ...who, logId: log.id, at: log.callStartAt };
    const calls = await this.prisma.authLogEvent.count({ where: { vn: log.vn, callStartAt: { gte: new Date(session.createdAt.getTime() - 5000), lte: new Date(Math.max(this.now().getTime(), log.callStartAt.getTime())) } } });
    if (calls !== 1) {
      await this.finish(session, 'FAILED', 'multiple_calls', callData);
      return { result: 'FAIL', reason: 'multiple_calls', sessionId: session.sessionId };
    }
    if (session.expectedPhoneHash && session.expectedPhoneHash !== who.callerHash) {
      await this.finish(session, 'FAILED', 'phone_mismatch', callData);
      return { result: 'FAIL', reason: 'phone_mismatch', sessionId: session.sessionId };
    }
    // the call is connected: this number takes no further calls (forwarding back to the guard line now)
    await this.pool.scheduleUnlink(session.vnId, this.now());
    this.pool.unlinkNow(session.vnId, this.carrier);
    if (session.mode === 'PC' && session.pcCode) {
      const codeExpiresAt = new Date(this.now().getTime() + s.pcCodeSeconds * 1000);
      const moved = await this.transition(session, 'CALL_CONFIRMED', null, callData, { expiresAt: new Date(codeExpiresAt.getTime() + 10_000), codeExpiresAt });
      if (!moved) return { result: 'FAIL', reason: 'second_call', sessionId: session.sessionId };
      await this.event(session.id, 'CALL_CONNECTED', { mode: 'PC' });
      // Read() waits this long after the guidance prompt (digits can also be keyed in during the prompt)
      return { result: 'OK', mode: 'PC', digits: session.pcCode.length, readTimeout: Math.max(5, s.pcCodeSeconds - PC_GUIDE_SECONDS), sessionId: session.sessionId };
    }
    return { result: 'OK', mode: 'APP', sessionId: session.sessionId };
  }

  /** PC mode: digits keyed in on the phone (DTMF) for the code shown on the PC. One try, within pcCodeSeconds. */
  async submitPhoneCode(uniqueId: string, codeRaw: string): Promise<PbxVerdict> {
    const s = await this.prisma.arsSession.findFirst({ where: { pbxUniqueId: (uniqueId ?? '').slice(0, 64), mode: 'PC' }, orderBy: { createdAt: 'desc' } });
    if (!s) return { result: 'FAIL', reason: 'no_session' };
    if (s.status !== 'CALL_CONFIRMED') return { result: 'FAIL', reason: s.status === 'VERIFIED' ? 'second_call' : s.failReason ?? 'second_call', sessionId: s.sessionId };
    const code = String(codeRaw ?? '').replace(/\D/g, '');
    const late = !s.codeExpiresAt || this.now().getTime() > s.codeExpiresAt.getTime() + 3000;
    let v: PbxVerdict;
    if (!code || late) v = { result: 'FAIL', reason: 'code_timeout', sessionId: s.sessionId };
    else if (code !== s.pcCode) v = { result: 'FAIL', reason: 'pc_code_wrong', sessionId: s.sessionId };
    else v = { result: 'OK', sessionId: s.sessionId };
    const moved = await this.finish(s, v.result === 'OK' ? 'VERIFIED' : 'FAILED', v.reason ?? null);
    if (!moved) return { result: 'FAIL', reason: 'second_call', sessionId: s.sessionId };
    await this.prisma.pbxCall.updateMany({ where: { uniqueId: s.pbxUniqueId! }, data: { result: v.result, reason: v.reason ?? null } });
    return v;
  }
  // ---------------------------------------------------------------------------------------------
  // state machine
  // ---------------------------------------------------------------------------------------------

  private async transition(
    s: Pick<ArsSession, 'id' | 'status'>, to: ArsSessionStatus, reason: string | null,
    call?: { callerHash: string; caller: string; uniqueId: string; logId: string; at: Date },
    extra?: { expiresAt?: Date; codeExpiresAt?: Date },
  ): Promise<boolean> {
    const data: Prisma.ArsSessionUpdateManyMutationInput = { status: to, failReason: reason };
    if (extra?.expiresAt) data.expiresAt = extra.expiresAt;
    if (extra?.codeExpiresAt) data.codeExpiresAt = extra.codeExpiresAt;
    if (call) Object.assign(data, { callerPhoneHash: call.callerHash, callerPhoneMasked: maskPhone(call.caller), callerPhoneEnc: sealText(call.caller),
      pbxUniqueId: call.uniqueId, authlogEventId: call.logId, callStartedAt: call.at });
    const final = to === 'VERIFIED' || to === 'FAILED' || to === 'EXPIRED' || to === 'CANCELED';
    if (final) Object.assign(data, { finishedAt: this.now(), pcCode: null });
    if (to === 'FAILED' || to === 'EXPIRED' || to === 'CANCELED') data.callerPhoneEnc = null; // phone is only kept to hand back on success
    const r = await this.prisma.arsSession.updateMany({ where: { id: s.id, status: s.status }, data });
    return r.count === 1;
  }

  /** Final transition exactly once; releases the number into cooldown. Success is immutable. */
  async finish(s: ArsSession, to: 'VERIFIED' | 'FAILED' | 'EXPIRED' | 'CANCELED', reason: string | null,
    call?: { callerHash: string; caller: string; uniqueId: string; logId: string; at: Date }): Promise<boolean> {
    const moved = await this.transition(s, to, reason, call);
    if (!moved) return false;
    await this.pool.release(s.vnId, (await this.settings.get()).cooldownSeconds, this.now());
    // a call that is still connected (success/failure message, PC digits being read) gets a short grace; otherwise off now
    let inCall = !!call;
    if (!inCall && s.pbxUniqueId) {
      const pc = await this.prisma.pbxCall.findUnique({ where: { uniqueId: s.pbxUniqueId } });
      inCall = !!pc && !pc.endedAt && this.now().getTime() - pc.startedAt.getTime() < 120_000;
    }
    await this.pool.scheduleUnlink(s.vnId, new Date(this.now().getTime() + (inCall ? IN_CALL_UNLINK_MS : 0)));
    await this.event(s.id, `SESSION_${to}`, { reason });
    return true;
  }

  async expireDue(): Promise<number> {
    const now = this.now();
    // PENDING keeps a short grace so a call placed just before the window closed can still be decided
    const due = await this.prisma.arsSession.findMany({ where: { OR: [
      { status: 'PENDING', expiresAt: { lt: new Date(now.getTime() - CALL_GRACE_MS) } },
      { status: 'CALL_CONFIRMED', expiresAt: { lt: now } },
    ] }, take: 500 });
    let n = 0;
    // PC: no code keyed in on the phone in time -> failed; otherwise nobody called in time -> expired
    for (const s of due) n += (await (s.status === 'CALL_CONFIRMED' ? this.finish(s, 'FAILED', 'code_timeout') : this.finish(s, 'EXPIRED', 'timeout'))) ? 1 : 0;
    return n;
  }

  private async event(sessionDbId: string, action: string, details: Record<string, unknown>) {
    await this.prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: `ARS_${action}`, targetType: 'ARS_SESSION', targetId: sessionDbId, details: details as Prisma.InputJsonValue } });
  }
}

/** "2026-10-21 16:52:03" (KST) or ISO -> Date. */
export function parseKstDateTime(v: string): Date | null {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
