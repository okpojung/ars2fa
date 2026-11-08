import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiKeyStatus } from '@prisma/client';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** viewable: the key is kept sealed and can be shown again after an ARS phone check (the key itself is never listed). */
  private async withViewable<T extends { id: string }>(rows: T[]) {
    const sealed = await this.prisma.apiKey.findMany({ where: { id: { in: rows.map((r) => r.id) }, keyEnc: { not: null } }, select: { id: true, revealCount: true, firstShownAt: true } });
    const left = new Map(sealed.map((s) => [s.id, Math.max(0, 3 - s.revealCount)]));
    const first = new Set(sealed.filter((s) => !s.firstShownAt).map((s) => s.id));
    return rows.map((r) => ({ ...r, viewable: left.has(r.id), viewsLeft: left.get(r.id) ?? 0, firstView: first.has(r.id) }));
  }

  async listForUser(userId: string) {
    return this.withViewable(await this.prisma.apiKey.findMany({
      where: { application: { userId } },
      include: {
        application: {
          include: { apps: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }));
  }

  async getForUser(userId: string, id: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, application: { userId } },
      include: { application: { include: { apps: true } } },
    });
    if (!apiKey) {
      throw new NotFoundException('API Key not found');
    }
    return (await this.withViewable([apiKey]))[0];
  }

  /** All keys with owner, apps and usage (sessions in total / this month / verified, last request). */
  async adminList() {
    const rows = await this.prisma.apiKey.findMany({
      include: {
        application: {
          include: {
            user: true,
            apps: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const ids = rows.map((r) => r.id);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [all, ok, month] = await Promise.all([
      this.prisma.arsSession.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: ids } }, _count: { _all: true }, _max: { createdAt: true } }),
      this.prisma.arsSession.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: ids }, status: 'VERIFIED' }, _count: { _all: true } }),
      this.prisma.arsSession.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: ids }, createdAt: { gte: monthStart } }, _count: { _all: true } }),
    ]);
    const a = new Map(all.map((g) => [g.apiKeyId, g]));
    const o = new Map(ok.map((g) => [g.apiKeyId, g._count._all]));
    const mo = new Map(month.map((g) => [g.apiKeyId, g._count._all]));
    return rows.map((r) => ({
      ...r,
      usage: { total: a.get(r.id)?._count._all ?? 0, verified: o.get(r.id) ?? 0, month: mo.get(r.id) ?? 0, lastAt: a.get(r.id)?._max.createdAt ?? null },
    }));
  }

  async changeStatus(id: string, status: ApiKeyStatus, adminId: string) {
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id }, omit: { keyHash: false } });
    if (!apiKey) {
      throw new NotFoundException('API Key not found');
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { status },
    });
    await this.redis.del(`api-key:${apiKey.keyHash}`);
    await this.prisma.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: adminId,
        action: `API_KEY_${status}`,
        targetType: 'API_KEY',
        targetId: id,
        details: { keyPrefix: apiKey.keyPrefix, status },
      },
    });
    return updated;
  }

  async updateLimits(
    id: string,
    dto: { monthlyLimit: number; rateLimitPerMinute?: number },
  ) {
    const updated = await this.prisma.apiKey.update({
      where: { id },
      omit: { keyHash: false },
      data: {
        monthlyLimit: dto.monthlyLimit,
        rateLimitPerMinute: dto.rateLimitPerMinute,
      },
    });
    const { keyHash, ...rest } = updated;
    await this.redis.del(`api-key:${keyHash}`);
    return rest;
  }
}
