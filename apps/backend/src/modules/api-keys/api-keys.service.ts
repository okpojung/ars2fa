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
    const sealed = await this.prisma.apiKey.findMany({ where: { id: { in: rows.map((r) => r.id) }, keyEnc: { not: null } }, select: { id: true, revealCount: true } });
    const left = new Map(sealed.map((s) => [s.id, Math.max(0, 3 - s.revealCount)]));
    return rows.map((r) => ({ ...r, viewable: left.has(r.id), viewsLeft: left.get(r.id) ?? 0 }));
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

  adminList() {
    return this.prisma.apiKey.findMany({
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
