import { ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AppPlatform, ApplicationApp } from '@prisma/client';
import { hmacSha256 } from '../../common/crypto.util';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

export type ClientIdentity = {
  api_key?: string;
  mobile_app_name?: string;
  client_platform?: AppPlatform | string;
  package_name?: string;
  bundle_id?: string;
};

export type VerifiedClient = { apiKeyId: string; app: ApplicationApp };

@Injectable()
export class ApiKeyAuthService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  /**
   * Resolves api_key + mobile_app_name + platform (+ package/bundle) to an approved app.
   * The key may come in the body or as "Authorization: Bearer"; app fields may come as headers.
   */
  async verify(id: ClientIdentity, ip?: string): Promise<VerifiedClient> {
    if (!id.api_key) throw new UnauthorizedException('UNAUTHORIZED_API_KEY');
    const platform = String(id.client_platform ?? '').toUpperCase();
    if (platform !== 'ANDROID' && platform !== 'IOS') throw new ForbiddenException('PLATFORM_NOT_ALLOWED');
    const keyHash = hmacSha256(process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret', id.api_key);
    const apiKey = await this.prisma.apiKey.findUnique({ where: { keyHash }, include: { application: { include: { apps: true } } } });
    if (!apiKey) throw new UnauthorizedException('UNAUTHORIZED_API_KEY');
    if (apiKey.status !== 'ACTIVE' || apiKey.application.status !== 'APPROVED' || (apiKey.expiresAt && apiKey.expiresAt < new Date())) {
      throw new ForbiddenException('API_KEY_DISABLED');
    }
    const allowed = apiKey.application.allowedIps?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    if (allowed.length && ip && !allowed.includes(ip)) throw new ForbiddenException('IP_NOT_ALLOWED');
    const app = apiKey.application.apps.find((a) => {
      if (a.status !== 'APPROVED' || a.mobileAppName !== id.mobile_app_name || a.platform !== platform) return false;
      if (platform === 'ANDROID' && a.packageName) return a.packageName === id.package_name;
      if (platform === 'IOS' && a.bundleId) return a.bundleId === id.bundle_id;
      return true;
    });
    if (!app) throw new ForbiddenException('APP_NOT_ALLOWED');

    const perMinute = apiKey.rateLimitPerMinute ?? 60;
    const count = await this.redis.incrementWithTtl(`rate:${apiKey.id}:${Math.floor(Date.now() / 60_000)}`, 120);
    if (count > perMinute) throw new HttpException('RATE_LIMIT_EXCEEDED', 429);
    const month = new Date();
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    // monthly limit 0 = unlimited
    if (apiKey.monthlyLimit > 0) {
      const used = await this.prisma.arsSession.count({ where: { apiKeyId: apiKey.id, createdAt: { gte: monthStart } } });
      if (used >= apiKey.monthlyLimit) throw new HttpException('MONTHLY_LIMIT_EXCEEDED', 429);
    }
    await this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    return { apiKeyId: apiKey.id, app };
  }
}
