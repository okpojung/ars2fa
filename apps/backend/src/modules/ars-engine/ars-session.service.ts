import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ArsSession, ArsSessionMode, ArsSessionStatus, Prisma } from '@prisma/client';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ArsSettingsService } from './ars-settings.service';
import { IntegrityInput, IntegrityService } from './integrity/integrity.service';
import { NumberPoolService } from './number-pool.service';
import { isHiddenCaller, isKrMobile, maskPhone, normalizeKrPhone, openText, phoneHash, sealText, valueHash } from './phone.util';
import { VerifiedClient } from './api-key-auth.service';

/** Result line returned to the PBX dialplan. */
export type PbxVerdict = { result: 'OK' | 'FAIL'; reason?: string; pcCode?: string; sessionId?: string };

/** Time slack between Daou's callStartTime and our INVITE time (measured INVITE->AuthLog 1-2 s). */
const AUTHLOG_BEFORE_MS = 20_000;
const AUTHLOG_AFTER_MS = 10_000;

export const FAIL_REASONS = [
  'hidden_caller', 'not_mobile', 'not_confirmed', 'no_authlog', 'no_session', 'multiple_calls',
  'second_call', 'phone_mismatch', 'pc_code_wrong', 'timeout', 'canceled_by_client', 'pool_mismatch',
] as const;

@Injectable()
export class ArsSessionService {
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: NumberPoolService,
    private readonly settings: ArsSettingsService,
    private readonly integrity: IntegrityService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // customer API
  // ---------------------------------------------------------------------------------------------

  async create(client: VerifiedClient, body: IntegrityInput & {
    mode?: ArsSessionMode; appsid?: string; purpose?: string; expected_phone?: string;
  }) {
    const s = await this.settings.get();
    const mode: ArsSessionMode = body.mode === 'PC' ? 'PC' : 'APP';
    let expectedHash: string | null = null;
    if (body.expected_phone) {
      const p = normalizeKrPhone(body.expected_phone);
      if (!p || (s.mobileOnly && !isKrMobile(p))) throw new BadRequestException('INVALID_EXPECTED_PHONE');
      expectedHash = phoneHash(p);
    }
    if (body.purpose && (body.purpose.length > 40 || !/^[\p{L}\p{N} _.\-]*$/u.test(body.purpose))) throw new BadRequestException('INVALID_PURPOSE');

    // App forgery check happens before a number is leased (ENFORCE refuses here).
    const integrity = await this.integrity.evaluate(client.app, client.apiKeyId, body);

    const now = this.now();
    const ttl = mode === 'PC' ? s.leaseSecondsPc : s.leaseSecondsApp;
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    // the number stays leased a little past expiry so a late call is still attributed (and rejected)
    const leased = await this.pool.lease(new Date(expiresAt.getTime() + 15_000), now);
    const sessionId = `ars_${randomBytes(15).toString('base64url')}`;
    const pcCode = mode === 'PC' && s.pcCodeEnabled ? String(randomInt(10, 100)) : null;
    const session = await this.prisma.arsSession.create({
      data: {
        sessionId, apiKeyId: client.apiKeyId, applicationAppId: client.app.id, mobileAppName: client.app.mobileAppName,
        displayName: client.app.displayName || client.app.mobileAppName, clientPlatform: client.app.platform, mode,
        appsid: body.appsid?.slice(0, 100), purpose: body.purpose ?? null, vnId: leased.vnId, vn: leased.vn, rn: leased.rn,
        expectedPhoneHash: expectedHash, pcCode, integrityVerdict: integrity.verdict, integrityDetail: integrity.detail as Prisma.InputJsonValue, expiresAt,
      },
    });
    await this.event(session.id, 'SESSION_CREATED', { mode, cycle: leased.cycleNo, position: leased.position, integrity: integrity.verdict });
    const dial = this.dialString(leased.vn);
    return {
      session_id: session.sessionId,
      status: session.status,
      mode,
      // The app dials this itself; it must not be printed on screen (see SDK guide).
      dial_number: dial,
      dial_uri: `tel:${dial}`,
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
    if (s.status === 'VERIFIED' && s.callerPhoneEnc) out.phone = openText(s.callerPhoneEnc);
    return out;
  }

  async cancel(client: VerifiedClient, sessionId: string) {
    const s = await this.find(client, sessionId);
    if (s.status !== 'PENDING' && s.status !== 'CALL_CONFIRMED') throw new ConflictException('SESSION_NOT_ACTIVE');
    await this.finish(s, 'CANCELED', 'canceled_by_client');
    return this.status(client, sessionId);
  }

  /** PC mode: the user types the 2 digits the ARS read out. */
  async submitPcCode(client: VerifiedClient, sessionId: string, code: string) {
    const s = await this.find(client, sessionId);
    if (s.status !== 'CALL_CONFIRMED' || !s.pcCode) throw new ConflictException('PC_CODE_NOT_EXPECTED');
    const max = (await this.settings.get()).pcCodeMaxAttempts;
    if (String(code ?? '').trim() === s.pcCode) {
      await this.finish(s, 'VERIFIED', null);
    } else {
      const attempts = s.pcCodeAttempts + 1;
      await this.prisma.arsSession.update({ where: { id: s.id }, data: { pcCodeAttempts: attempts } });
      if (attempts >= max) await this.finish({ ...s, pcCodeAttempts: attempts }, 'FAILED', 'pc_code_wrong');
    }
    return this.status(client, sessionId);
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
  async verifyCall(input: { rn: string; caller: string; uniqueId: string; t0: Date; confirmKey?: string }): Promise<PbxVerdict> {
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
    if (session.status !== 'PENDING') {
      // a second call to an already decided session: never changes the outcome
      await this.event(session.id, 'EXTRA_CALL_REJECTED', { callerMasked: maskPhone(caller) });
      return done({ result: 'FAIL', reason: 'second_call', sessionId: session.sessionId });
    }
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
    if (session.mode === 'PC' && session.pcCode) {
      const moved = await this.transition(session, 'CALL_CONFIRMED', null, callData);
      if (!moved) return done({ result: 'FAIL', reason: 'second_call', sessionId: session.sessionId });
      return done({ result: 'OK', pcCode: session.pcCode, sessionId: session.sessionId });
    }
    const ok = await this.finish(session, 'VERIFIED', null, callData);
    return done(ok ? { result: 'OK', sessionId: session.sessionId } : { result: 'FAIL', reason: 'second_call', sessionId: session.sessionId });
  }

  // ---------------------------------------------------------------------------------------------
  // state machine
  // ---------------------------------------------------------------------------------------------

  private async transition(
    s: Pick<ArsSession, 'id' | 'status'>, to: ArsSessionStatus, reason: string | null,
    call?: { callerHash: string; caller: string; uniqueId: string; logId: string; at: Date },
  ): Promise<boolean> {
    const data: Prisma.ArsSessionUpdateManyMutationInput = { status: to, failReason: reason };
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
    await this.event(s.id, `SESSION_${to}`, { reason });
    return true;
  }

  async expireDue(): Promise<number> {
    const due = await this.prisma.arsSession.findMany({ where: { status: { in: ['PENDING', 'CALL_CONFIRMED'] }, expiresAt: { lt: this.now() } }, take: 500 });
    let n = 0;
    for (const s of due) n += (await this.finish(s, 'EXPIRED', 'timeout')) ? 1 : 0;
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
