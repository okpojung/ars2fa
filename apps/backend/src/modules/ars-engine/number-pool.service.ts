import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
export type LeasedNumber = { vnId: number; vn: string; rn: string; cycleNo: number; position: number };

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
  async lease(leaseUntil: Date, now = new Date()): Promise<LeasedNumber> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      let cycle = await tx.vnCycle.findFirst({ where: { completedAt: null }, orderBy: { cycleNo: 'desc' } });
      if (!cycle) cycle = await this.newCycle(tx);
      for (let attempt = 0; attempt < 2; attempt++) {
        // numbers disabled since the cycle was built are skipped for this cycle
        await tx.$executeRaw`UPDATE "VnCycleSlot" s SET "skippedAt" = ${now}
          FROM "VirtualNumber" v WHERE v.id = s."vnId" AND s."cycleId" = ${cycle.id} AND s."usedAt" IS NULL AND s."skippedAt" IS NULL AND v.status <> 'ACTIVE'`;
        const rows = await tx.$queryRaw<{ slotId: number; position: number; vnId: number; vn: string; rn: string }[]>`
          SELECT s.id AS "slotId", s.position, v.id AS "vnId", v.vn, v.rn
          FROM "VnCycleSlot" s JOIN "VirtualNumber" v ON v.id = s."vnId"
          WHERE s."cycleId" = ${cycle.id} AND s."usedAt" IS NULL AND s."skippedAt" IS NULL
            AND v.status = 'ACTIVE'
            AND (v."leasedUntil" IS NULL OR v."leasedUntil" < ${now})
            AND (v."cooldownUntil" IS NULL OR v."cooldownUntil" < ${now})
          ORDER BY s.position LIMIT 1`;
        if (rows.length) {
          const r = rows[0];
          await tx.vnCycleSlot.update({ where: { id: r.slotId }, data: { usedAt: now } });
          await tx.virtualNumber.update({ where: { id: r.vnId }, data: { leasedUntil: leaseUntil, lastUsedAt: now, useCount: { increment: 1 } } });
          return { vnId: r.vnId, vn: r.vn, rn: r.rn, cycleNo: cycle.cycleNo, position: r.position };
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

  async summary() {
    const now = new Date();
    const [total, active, leased, cooling, cycle] = await Promise.all([
      this.prisma.virtualNumber.count(),
      this.prisma.virtualNumber.count({ where: { status: 'ACTIVE' } }),
      this.prisma.virtualNumber.count({ where: { leasedUntil: { gt: now } } }),
      this.prisma.virtualNumber.count({ where: { cooldownUntil: { gt: now } } }),
      this.prisma.vnCycle.findFirst({ where: { completedAt: null }, orderBy: { cycleNo: 'desc' } }),
    ]);
    const used = cycle ? await this.prisma.vnCycleSlot.count({ where: { cycleId: cycle.id, usedAt: { not: null } } }) : 0;
    const lines = await this.prisma.virtualNumber.groupBy({ by: ['rn'], _count: { _all: true }, orderBy: { rn: 'asc' } });
    return { total, active, leased, cooling, cycle: cycle ? { cycleNo: cycle.cycleNo, size: cycle.size, used } : null,
      lines: lines.map((l) => ({ rn: l.rn, numbers: l._count._all })) };
  }

  async list(params: { q?: string; status?: string; skip?: number; take?: number }) {
    const where: Prisma.VirtualNumberWhereInput = {};
    if (params.q) where.OR = [{ vn: { contains: params.q.replace(/\D/g, '') } }, { rn: { contains: params.q.replace(/\D/g, '') } }];
    if (params.status === 'ACTIVE' || params.status === 'DISABLED') where.status = params.status;
    const [items, total] = await Promise.all([
      this.prisma.virtualNumber.findMany({ where, orderBy: { ordinal: 'asc' }, skip: params.skip ?? 0, take: Math.min(params.take ?? 100, 500) }),
      this.prisma.virtualNumber.count({ where }),
    ]);
    return { items, total };
  }

  async setStatus(id: number, status: 'ACTIVE' | 'DISABLED', actor: string) {
    const r = await this.prisma.virtualNumber.update({ where: { id }, data: { status } });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: actor, action: `VN_${status}`, targetType: 'VIRTUAL_NUMBER', targetId: String(id), details: { vn: r.vn } } });
    return r;
  }
}
