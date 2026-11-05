import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const KST_MS = 9 * 3600_000;
export const kstDayStart = (d = new Date()) => {
  const k = new Date(d.getTime() + KST_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_MS);
};

/**
 * Concurrent call monitoring. The PBX host samples Asterisk every 2 s and posts here (internal/pbx/trunk):
 * trunk = channels on the SKB SIP trunk (every 0507/070 call arrives there), total = all Asterisk calls,
 * maxcalls = Asterisk's own limit (asterisk.conf). Capacity = contracted SIP trunk channels (SIP_TRUNK_CHANNELS, default 30).
 */
@Injectable()
export class TrunkMonitorService {
  private readonly log = new Logger('TrunkMonitor');
  private live: { trunk: number; total: number; maxcalls: number | null; at: Date } | null = null;
  private lastPurge = 0;

  constructor(private readonly prisma: PrismaService) {}

  capacity() {
    const n = Number(process.env.SIP_TRUNK_CHANNELS ?? 30);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  async record(input: { trunk: number; total: number; trunkPeak?: number; totalPeak?: number; maxcalls?: number | null }) {
    const clamp = (v: unknown) => Math.max(0, Math.min(10_000, Math.floor(Number(v) || 0)));
    const trunk = clamp(input.trunk), total = clamp(input.total);
    const tp = Math.max(trunk, clamp(input.trunkPeak)), op = Math.max(total, clamp(input.totalPeak));
    const maxcalls = input.maxcalls == null || !Number(input.maxcalls) ? (this.live?.maxcalls ?? null) : clamp(input.maxcalls);
    this.live = { trunk, total, maxcalls, at: new Date() };
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await this.prisma.$executeRaw`
      INSERT INTO "TrunkMinute" ("minute", "trunkMax", "totalMax", "samples", "updatedAt") VALUES (${minute}, ${tp}, ${op}, 1, now())
      ON CONFLICT ("minute") DO UPDATE SET "trunkMax" = GREATEST("TrunkMinute"."trunkMax", EXCLUDED."trunkMax"),
        "totalMax" = GREATEST("TrunkMinute"."totalMax", EXCLUDED."totalMax"), "samples" = "TrunkMinute"."samples" + 1, "updatedAt" = now()`;
    if (Date.now() - this.lastPurge > 6 * 3600_000) {
      this.lastPurge = Date.now();
      await this.prisma.trunkMinute.deleteMany({ where: { minute: { lt: new Date(Date.now() - 400 * 86400_000) } } }).catch((e) => this.log.warn(String(e)));
    }
  }

  private async peak(from: Date) {
    const r = await this.prisma.trunkMinute.findFirst({ where: { minute: { gte: from } }, orderBy: [{ trunkMax: 'desc' }, { minute: 'desc' }] });
    return r ? { calls: r.trunkMax, at: r.minute } : { calls: 0, at: null };
  }

  /** Dashboard block. */
  async summary() {
    const now = new Date();
    const today = kstDayStart(now);
    const capacity = this.capacity();
    const fresh = !!this.live && now.getTime() - this.live.at.getTime() < 30_000;
    const maxcalls = this.live?.maxcalls ?? null;
    const limit = maxcalls ? Math.min(capacity, maxcalls) : capacity;
    const warnAt = Math.ceil(limit * 0.8);

    const since24 = new Date(now.getTime() - 24 * 3600_000);
    const rows24 = await this.prisma.trunkMinute.findMany({ where: { minute: { gte: since24 } }, select: { minute: true, trunkMax: true } });
    const bucketMs = 30 * 60_000;
    const start = Math.floor(since24.getTime() / bucketMs) * bucketMs + bucketMs;
    const buckets = Array.from({ length: 48 }, (_, i) => ({ at: new Date(start + i * bucketMs), max: 0 }));
    for (const r of rows24) {
      const i = Math.floor((r.minute.getTime() - start) / bucketMs);
      if (i >= 0 && i < 48) buckets[i].max = Math.max(buckets[i].max, r.trunkMax);
    }
    const daily = await this.prisma.$queryRaw<{ day: string; peak: number; busy: number }[]>`
      SELECT to_char(("minute" + interval '9 hour')::date, 'YYYY-MM-DD') AS day, max("trunkMax")::int AS peak,
             count(*) FILTER (WHERE "trunkMax" >= ${warnAt})::int AS busy
      FROM "TrunkMinute" WHERE "minute" >= ${new Date(today.getTime() - 29 * 86400_000)} GROUP BY 1 ORDER BY 1`;
    const busyToday = daily.find((d) => d.day === new Date(today.getTime() + KST_MS).toISOString().slice(0, 10))?.busy ?? 0;
    return {
      live: fresh ? { trunk: this.live!.trunk, total: this.live!.total, at: this.live!.at } : null,
      capacity, maxcalls, limit, warnAt,
      peakToday: await this.peak(today),
      peak7d: await this.peak(new Date(today.getTime() - 6 * 86400_000)),
      peak30d: await this.peak(new Date(today.getTime() - 29 * 86400_000)),
      busyMinutesToday: busyToday,
      last24h: buckets,
      daily30: daily,
    };
  }
}
