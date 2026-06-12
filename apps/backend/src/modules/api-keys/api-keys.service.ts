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

  listForUser(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { application: { userId } },
      include: {
        application: {
          include: { apps: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForUser(userId: string, id: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, application: { userId } },
      include: { application: { include: { apps: true } } },
    });
    if (!apiKey) {
      throw new NotFoundException('API Key not found');
    }
    return apiKey;
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
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id } });
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
      data: {
        monthlyLimit: dto.monthlyLimit,
        rateLimitPerMinute: dto.rateLimitPerMinute,
      },
    });
    await this.redis.del(`api-key:${updated.keyHash}`);
    return updated;
  }
}
