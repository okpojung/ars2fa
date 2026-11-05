import { PrismaService } from '../src/prisma/prisma.service';
import { hmacSha256 } from '../src/common/crypto.util';

export const TEST_KEY = 'ars2fa_test_integration_key_0123456789abcdefghij';

export async function resetDb(prisma: PrismaService) {
  if (!/ars2fa_test/.test(process.env.DATABASE_URL ?? '')) throw new Error('refusing: DATABASE_URL must point at an ars2fa_test database');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function seedClient(prisma: PrismaService, opts: { policy?: 'OFF' | 'MONITOR' | 'ENFORCE'; platform?: 'ANDROID' | 'IOS'; monthlyLimit?: number } = {}) {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}${Math.random()}@ex.com`, passwordHash: 'x', companyName: 'Co', contactName: 'N', contactPhone: '01000000000' } });
  const application = await prisma.apiApplication.create({ data: { userId: user.id, serviceName: 'Svc', usagePurpose: 'test', expectedMonthlyRequests: 100, status: 'APPROVED' } });
  const app = await prisma.applicationApp.create({ data: {
    applicationId: application.id, mobileAppName: 'BS Point', displayName: '바로포인트', platform: opts.platform ?? 'ANDROID',
    packageName: 'com.example.bspoint', bundleId: 'com.example.bsPoint', iosTeamId: 'ABCDE12345', status: 'APPROVED', integrityPolicy: opts.policy ?? 'MONITOR',
  } });
  const key = `${TEST_KEY}${Math.random().toString(36).slice(2, 8)}`;
  await prisma.apiKey.create({ data: { applicationId: application.id, keyPrefix: key.slice(0, 14), keyHash: hmacSha256(process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret', key), status: 'ACTIVE', monthlyLimit: opts.monthlyLimit ?? 10000, rateLimitPerMinute: 1000 } });
  return { app, key, identity: { api_key: key, mobile_app_name: 'BS Point', client_platform: (opts.platform ?? 'ANDROID') as 'ANDROID' | 'IOS', package_name: 'com.example.bspoint', bundle_id: 'com.example.bsPoint' } };
}

export function numbers(n: number, base = 5070095_2000): string[] {
  return Array.from({ length: n }, (_, i) => `0${base + i}`);
}

export const LINES = ['07051901950', '07051901951', '07051901952'];

export function kst(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return k.toISOString().slice(0, 19).replace('T', ' ');
}
