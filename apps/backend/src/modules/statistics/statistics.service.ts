import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedPrincipal } from '../../common/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { TrunkMonitorService } from '../ars-engine/trunk-monitor.service';

const KST_MS = 9 * 3600_000;
/** Start of today in KST as a UTC Date. */
function kstDayStart(d = new Date()): Date {
  const k = new Date(d.getTime() + KST_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_MS);
}

/** Dashboard numbers from the ARS engine (ArsSession). Customers see only their own API keys. */
@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService, private readonly trunk: TrunkMonitorService) {}

  async summary(principal: AuthenticatedPrincipal) {
    const admin = principal.kind === 'admin';
    const where: Prisma.ArsSessionWhereInput = admin ? {} : { apiKey: { application: { userId: principal.id } } };
    const today = kstDayStart();
    const count = (extra: Prisma.ArsSessionWhereInput) => this.prisma.arsSession.count({ where: { ...where, ...extra } });

    const [total, success, failed, expired, canceled, inProgress, tToday, sToday, fToday, eToday] = await Promise.all([
      count({}), count({ status: 'VERIFIED' }), count({ status: 'FAILED' }), count({ status: 'EXPIRED' }), count({ status: 'CANCELED' }),
      count({ status: { in: ['PENDING', 'CALL_CONFIRMED'] } }),
      count({ createdAt: { gte: today } }), count({ createdAt: { gte: today }, status: 'VERIFIED' }),
      count({ createdAt: { gte: today }, status: 'FAILED' }), count({ createdAt: { gte: today }, status: 'EXPIRED' }),
    ]);
    const decided = success + failed + expired;
    const rate = (s: number, d: number) => (d === 0 ? 0 : Number(((s / d) * 100).toFixed(1)));

    const reasons = await this.prisma.arsSession.groupBy({ by: ['failReason'], where: { ...where, status: { in: ['FAILED', 'EXPIRED'] } }, _count: { _all: true } });
    const since = new Date(today.getTime() - 13 * 86400_000);
    const recentRows = await this.prisma.arsSession.findMany({ where: { ...where, createdAt: { gte: since } }, select: { createdAt: true, status: true } });
    const daily = Array.from({ length: 14 }, (_, i) => {
      const from = new Date(since.getTime() + i * 86400_000);
      const day = new Date(from.getTime() + KST_MS).toISOString().slice(0, 10);
      const rows = recentRows.filter((r) => r.createdAt >= from && r.createdAt < new Date(from.getTime() + 86400_000));
      return { day, total: rows.length, success: rows.filter((r) => r.status === 'VERIFIED').length };
    });
    const out: Record<string, unknown> = {
      total, success, failed: failed + expired, failedOnly: failed, expired, canceled, inProgress,
      successRate: rate(success, decided),
      today: { total: tToday, success: sToday, failed: fToday + eToday, successRate: rate(sToday, sToday + fToday + eToday) },
      failReasons: reasons.map((r) => ({ reason: r.failReason ?? 'unknown', count: r._count._all })).sort((a, b) => b.count - a.count),
      daily,
    };
    if (!admin) return out;

    const now = new Date();
    const day = new Date(now.getTime() - 86400_000);
    const [poolTotal, poolActive, leased, cooling, linkOn, linkUnknown, carrierOk, carrierFail, carrierAvg, lastFail, cycle, recent, calls24, invalid24] = await Promise.all([
      this.prisma.virtualNumber.count({ where: { routing: 'DYNAMIC' } }),
      this.prisma.virtualNumber.count({ where: { routing: 'DYNAMIC', status: 'ACTIVE' } }),
      this.prisma.virtualNumber.count({ where: { leasedUntil: { gt: now } } }),
      this.prisma.virtualNumber.count({ where: { cooldownUntil: { gt: now } } }),
      this.prisma.virtualNumber.count({ where: { routing: 'DYNAMIC', linkState: 'ON' } }),
      this.prisma.virtualNumber.count({ where: { routing: 'DYNAMIC', linkState: 'UNKNOWN' } }),
      this.prisma.carrierCall.count({ where: { createdAt: { gte: day }, ok: true } }),
      this.prisma.carrierCall.count({ where: { createdAt: { gte: day }, ok: false } }),
      this.prisma.carrierCall.aggregate({ where: { createdAt: { gte: day }, ok: true }, _avg: { ms: true } }),
      this.prisma.carrierCall.findFirst({ where: { ok: false }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, resCd: true, resMsg: true } }),
      this.prisma.vnCycle.findFirst({ where: { completedAt: null }, orderBy: { cycleNo: 'desc' } }),
      this.prisma.arsSession.findMany({ orderBy: { createdAt: 'desc' }, take: 10,
        select: { sessionId: true, mobileAppName: true, mode: true, status: true, failReason: true, callerPhoneMasked: true, createdAt: true, vn: true } }),
      this.prisma.pbxCall.count({ where: { createdAt: { gte: day } } }),
      this.prisma.pbxCall.count({ where: { createdAt: { gte: day }, reason: { in: ['no_session', 'no_authlog', 'pool_mismatch'] } } }),
    ]);
    const cycleUsed = cycle ? await this.prisma.vnCycleSlot.count({ where: { cycleId: cycle.id, usedAt: { not: null } } }) : 0;
    out.pool = { total: poolTotal, active: poolActive, leased, cooling, linkOn, linkUnknown,
      cycle: cycle ? { cycleNo: cycle.cycleNo, used: cycleUsed, size: cycle.size } : null };
    out.carrier24h = { ok: carrierOk, failed: carrierFail, avgMs: Math.round(carrierAvg._avg.ms ?? 0), lastFailure: lastFail };
    out.calls24h = { total: calls24, invalid: invalid24 };
    out.recent = recent;
    out.trunk = await this.trunk.summary();
    return out;
  }
}
