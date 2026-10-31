import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
export type LeasedNumber = { vnId: number; vn: string; rn: string; cycleNo: number; position: number; routing: 'DYNAMIC' | 'STATIC' };

/** Advisory lock key serializing all pool mutations (allocation, cycle rollover, import). */
const POOL_LOCK = 734001;

/** CSPRNG Fisher-Yates shuffle. */
export function secureShuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 070 lines are assigned to 0507 numbers in inventory order: ordinal 0 -> line 0, 1 -> line 1, ... wrapping. */
export function sequentialRn(ordinal: number, lines: string[]): string {
  return lines[ordinal % lines.length];
}

@Injectable()
export class NumberPoolService {
  constructor(private readonly prisma: PrismaService) {}

  private async lock(tx: Tx) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POOL_LOCK})`;
  }

  /**
   * Imports the 0507 inventory in the given order and maps each number to a 070 line sequentially.
   * Existing numbers keep their ordinal/rn unless remapRn is set. Returns counts.
   */
  async importInventory(vns: string[], lines: string[], opts: { remapRn?: boolean } = {}) {
    const clean = vns.map((v) => v.replace(/\D/g, ''));
    if (new Set(clean).size !== clean.length) throw new HttpException('DUPLICATE_NUMBERS', 400);
    if (clean.some((v) => !/^050[0-9]{8,9}$/.test(v))) throw new HttpException('INVALID_0507_NUMBER', 400);
    const rns = lines.map((v) => v.replace(/\D/g, ''));
    if (!rns.length || rns.some((v) => !/^0[0-9]{8,11}$/.test(v)) || new Set(rns).size !== rns.length) throw new HttpException('INVALID_RN_LINES', 400);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      let created = 0;
      let remapped = 0;
      const existing = await tx.virtualNumber.findMany();
      const byVn = new Map(existing.map((e) => [e.vn, e]));
      let nextOrdinal = existing.reduce((m, e) => Math.max(m, e.ordinal + 1), 0);
      for (const vn of clean) {
        const e = byVn.get(vn);
        if (!e) {
          const ordinal = nextOrdinal++;
          await tx.virtualNumber.create({ data: { vn, ordinal, rn: sequentialRn(ordinal, rns) } });
          created++;
        } else if (opts.remapRn) {
          const rn = sequentialRn(e.ordinal, rns);
          if (rn !== e.rn) {
            await tx.virtualNumber.update({ where: { id: e.id }, data: { rn } });
            remapped++;
          }
        }
      }
      return { created, remapped, total: existing.length + created };
    }, { timeout: 60_000 });
  }

  /** Creates the next cycle: one CSPRNG permutation of every ACTIVE number. */
  private async newCycle(tx: Tx) {
    const last = await tx.vnCycle.findFirst({ orderBy: { cycleNo: 'desc' } });
    const ids = (await tx.virtualNumber.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((r) => r.id);
    if (!ids.length) throw new HttpException('NO_NUMBER_AVAILABLE', 503);
    const order = secureShuffle(ids);
    const cycle = await tx.vnCycle.create({ data: { cycleNo: (last?.cycleNo ?? 0) + 1, size: order.length } });
    await tx.vnCycleSlot.createMany({ data: order.map((vnId, position) => ({ cycleId: cycle.id, position, vnId })) });
    return cycle;
  }

  /**
   * Leases the next number of the current random cycle. Numbers still leased or cooling down are
   * passed over for now and stay unused in this cycle (taken later). A new permutation is generated
   * only after every slot of the cycle has been used.
   */
  async lease(leaseUntil: Date, now = new Date(), opts: { dynamic?: boolean } = {}): Promise<LeasedNumber> {
    const dynamic = opts.dynamic ?? true;
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      let cycle = await tx.vnCycle.findFirst({ where: { completedAt: null }, orderBy: { cycleNo: 'desc' } });
      if (!cycle) cycle = await this.newCycle(tx);
      for (let attempt = 0; attempt < 2; attempt++) {
        // numbers disabled since the cycle was built are skipped for this cycle
        await tx.$executeRaw`UPDATE "VnCycleSlot" s SET "skippedAt" = ${now}
          FROM "VirtualNumber" v WHERE v.id = s."vnId" AND s."cycleId" = ${cycle.id} AND s."usedAt" IS NULL AND s."skippedAt" IS NULL AND v.status <> 'ACTIVE'`;
        // DYNAMIC numbers are only handed out while their forwarding is known to be off
        const rows = await tx.$queryRaw<{ slotId: number; position: number; vnId: number; vn: string; rn: string; routing: 'DYNAMIC' | 'STATIC' }[]>`
          SELECT s.id AS "slotId", s.position, v.id AS "vnId", v.vn, v.rn, v.routing::text AS routing
          FROM "VnCycleSlot" s JOIN "VirtualNumber" v ON v.id = s."vnId"
          WHERE s."cycleId" = ${cycle.id} AND s."usedAt" IS NULL AND s."skippedAt" IS NULL
            AND v.status = 'ACTIVE'
            AND (v.routing = 'STATIC' OR (${dynamic} AND v."linkState" = 'OFF'))
            AND (v."leasedUntil" IS NULL OR v."leasedUntil" < ${now})
            AND (v."cooldownUntil" IS NULL OR v."cooldownUntil" < ${now})
          ORDER BY s.position LIMIT 1`;
        if (rows.length) {
          const r = rows[0];
          await tx.vnCycleSlot.update({ where: { id: r.slotId }, data: { usedAt: now } });
          await tx.virtualNumber.update({ where: { id: r.vnId }, data: {
            leasedUntil: leaseUntil, lastUsedAt: now, useCount: { increment: 1 },
            // pessimistic until the carrier confirms: a crash mid-call still gets the forwarding switched off
            ...(r.routing === 'DYNAMIC' ? { linkState: 'UNKNOWN' as const, unlinkAfter: leaseUntil } : {}),
          } });
          return { vnId: r.vnId, vn: r.vn, rn: r.rn, cycleNo: cycle.cycleNo, position: r.position, routing: r.routing };
        }
        const remaining = await tx.vnCycleSlot.count({ where: { cycleId: cycle.id, usedAt: null, skippedAt: null } });
        if (remaining > 0) break; // every remaining number is busy right now
        await tx.vnCycle.update({ where: { id: cycle.id }, data: { completedAt: now } });
        cycle = await this.newCycle(tx);
      }
      throw new HttpException('NO_NUMBER_AVAILABLE', 503);
    }, { timeout: 15_000 });
  }

  /** Ends a lease; the number rests for cooldownSeconds before it can be handed out again. */
  async release(vnId: number, cooldownSeconds: number, now = new Date()) {
    await this.prisma.virtualNumber.update({
      where: { id: vnId },
      data: { leasedUntil: null, cooldownUntil: new Date(now.getTime() + cooldownSeconds * 1000) },
    });
  }

  /** Carrier confirmed forwarding on: the number is reachable until unlinkAfter. */
  async markLinked(vnId: number, leasedUntil: Date, unlinkAfter: Date, now = new Date()) {
    await this.prisma.virtualNumber.update({ where: { id: vnId }, data: { linkState: 'ON', leasedUntil, unlinkAfter, linkChangedAt: now, linkFailCount: 0, linkError: null } });
  }

  /** Forwarding could not be switched on: give the number back (resting) and make sure it is switched off. */
  async linkFailed(vnId: number, error: string, cooldownSeconds: number, now = new Date()) {
    await this.prisma.virtualNumber.update({ where: { id: vnId }, data: {
      linkState: 'UNKNOWN', unlinkAfter: now, linkError: error.slice(0, 200), leasedUntil: null,
      cooldownUntil: new Date(now.getTime() + Math.max(cooldownSeconds, 30) * 1000),
    } });
  }

  /** Bring the forwarding switch-off forward to `at` (never later than already scheduled). */
  async scheduleUnlink(vnId: number, at: Date) {
    await this.prisma.$executeRaw`UPDATE "VirtualNumber" SET "unlinkAfter" = LEAST(COALESCE("unlinkAfter", ${at}), ${at}), "updatedAt" = now()
      WHERE id = ${vnId} AND routing = 'DYNAMIC' AND "linkState" <> 'OFF'`;
  }

  /** After a restart: anything possibly forwarded without a schedule is switched off now. */
  async reconcileLinks(now = new Date()) {
    return this.prisma.$executeRaw`UPDATE "VirtualNumber" SET "unlinkAfter" = ${now}
      WHERE routing = 'DYNAMIC' AND "linkState" <> 'OFF' AND "unlinkAfter" IS NULL`;
  }

  /**
   * Switches off forwarding that is due. Failures stay UNKNOWN (never leased) and are retried with backoff
   * (2, 4, 8 ... max 60 s).
   */
  async unlinkDue(carrier: { enabled: boolean; set: (vnId: number, vn: string, rn: string, link: boolean) => Promise<{ ok: boolean; code: string; message: string }> }, now = new Date(), limit = 20) {
    if (!carrier.enabled) return { done: 0, failed: 0 };
    const due = await this.prisma.virtualNumber.findMany({
      where: { routing: 'DYNAMIC', linkState: { in: ['ON', 'UNKNOWN'] }, unlinkAfter: { lte: now } },
      orderBy: { unlinkAfter: 'asc' }, take: limit,
    });
    let done = 0;
    let failed = 0;
    for (const n of due) {
      const r = await carrier.set(n.id, n.vn, n.rn, false);
      const t = new Date();
      if (r.ok) {
        // only if nobody re-leased it meanwhile (it cannot be: UNKNOWN/ON numbers are never leased)
        await this.prisma.virtualNumber.updateMany({ where: { id: n.id, linkState: { in: ['ON', 'UNKNOWN'] } },
          data: { linkState: 'OFF', unlinkAfter: null, linkChangedAt: t, linkFailCount: 0, linkError: null } });
        done++;
      } else {
        const fails = n.linkFailCount + 1;
        await this.prisma.virtualNumber.update({ where: { id: n.id }, data: {
          linkState: 'UNKNOWN', linkFailCount: fails, linkError: `${r.code} ${r.message}`.slice(0, 200),
          unlinkAfter: new Date(t.getTime() + Math.min(60, 2 ** Math.min(fails, 6)) * 1000),
        } });
        failed++;
      }
    }
    return { done, failed };
  }

  async summary() {
    const now = new Date();
    const [linkOn, linkUnknown, linkFailing] = await Promise.all([
      this.prisma.virtualNumber.count({ where: { routing: 'DYNAMIC', linkState: 'ON' } }),
      this.prisma.virtualNumber.count({ where: { routing: 'DYNAMIC', linkState: 'UNKNOWN' } }),
      this.prisma.virtualNumber.count({ where: { routing: 'DYNAMIC', linkFailCount: { gt: 0 } } }),
    ]);
    const [total, active, leased, cooling, cycle] = await Promise.all([
      this.prisma.virtualNumber.count(),
      this.prisma.virtualNumber.count({ where: { status: 'ACTIVE' } }),
      this.prisma.virtualNumber.count({ where: { leasedUntil: { gt: now } } }),
      this.prisma.virtualNumber.count({ where: { cooldownUntil: { gt: now } } }),
      this.prisma.vnCycle.findFirst({ where: { completedAt: null }, orderBy: { cycleNo: 'desc' } }),
    ]);
    const used = cycle ? await this.prisma.vnCycleSlot.count({ where: { cycleId: cycle.id, usedAt: { not: null } } }) : 0;
    const lines = await this.prisma.virtualNumber.groupBy({ by: ['rn'], _count: { _all: true }, orderBy: { rn: 'asc' } });
    return { total, active, leased, cooling, linkOn, linkUnknown, linkFailing, cycle: cycle ? { cycleNo: cycle.cycleNo, size: cycle.size, used } : null,
      lines: lines.map((l) => ({ rn: l.rn, numbers: l._count._all })) };
  }

  /**
   * Pool list. sort=random (default): the order of the current random cycle (position = hand-out order);
   * vn_asc / vn_desc: by 0507 number. Every item carries its position in the current cycle and whether it
   * was already handed out in this cycle.
   */
  async list(params: { q?: string; status?: string; sort?: string; skip?: number; take?: number }) {
    const where: Prisma.VirtualNumberWhereInput = {};
    const digits = (params.q ?? '').replace(/\D/g, '');
    if (digits) where.OR = [{ vn: { contains: digits } }, { rn: { contains: digits } }];
    if (params.status === 'ACTIVE' || params.status === 'DISABLED') where.status = params.status;
    const skip = params.skip ?? 0;
    const take = Math.min(params.take ?? 100, 500);
    const cycle = await this.prisma.vnCycle.findFirst({ where: { completedAt: null }, orderBy: { cycleNo: 'desc' } });
    const total = await this.prisma.virtualNumber.count({ where });
    type Item = Awaited<ReturnType<typeof this.prisma.virtualNumber.findMany>>[number] & { position: number | null; usedInCycle: boolean };
    let items: Item[];
    if ((params.sort ?? 'random') === 'random' && cycle) {
      // numbers of the current cycle in hand-out order, then any number not in the cycle (added later) by inventory order
      const slots = await this.prisma.vnCycleSlot.findMany({ where: { cycleId: cycle.id, number: where }, orderBy: { position: 'asc' }, skip, take, include: { number: true } });
      items = slots.map((s) => ({ ...s.number, position: s.position, usedInCycle: !!s.usedAt }));
      const inCycle = await this.prisma.vnCycleSlot.count({ where: { cycleId: cycle.id, number: where } });
      if (items.length < take && skip + items.length >= inCycle) {
        const rest = await this.prisma.virtualNumber.findMany({ where: { ...where, slots: { none: { cycleId: cycle.id } } }, orderBy: { ordinal: 'asc' },
          skip: Math.max(0, skip - inCycle), take: take - items.length });
        items.push(...rest.map((n) => ({ ...n, position: null, usedInCycle: false })));
      }
    } else {
      const rows = await this.prisma.virtualNumber.findMany({ where, orderBy: params.sort === 'vn_desc' ? { vn: 'desc' } : params.sort === 'vn_asc' ? { vn: 'asc' } : { ordinal: 'asc' }, skip, take });
      const slots = cycle ? await this.prisma.vnCycleSlot.findMany({ where: { cycleId: cycle.id, vnId: { in: rows.map((r) => r.id) } } }) : [];
      const byId = new Map(slots.map((s) => [s.vnId, s]));
      items = rows.map((n) => ({ ...n, position: byId.get(n.id)?.position ?? null, usedInCycle: !!byId.get(n.id)?.usedAt }));
    }
    return { items, total, cycle: cycle ? { cycleNo: cycle.cycleNo, size: cycle.size } : null };
  }

  async setStatus(id: number, status: 'ACTIVE' | 'DISABLED', actor: string) {
    const r = await this.prisma.virtualNumber.update({ where: { id }, data: { status } });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: actor, action: `VN_${status}`, targetType: 'VIRTUAL_NUMBER', targetId: String(id), details: { vn: r.vn } } });
    return r;
  }
}
