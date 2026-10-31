import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://ars2fa:ars2fa@localhost:5432/ars2fa?schema=public',
    });
    // Secrets are never read unless a query asks for them explicitly (omit: { field: false }):
    // responses that include users or API keys can then never leak password or key hashes.
    super({ adapter, omit: { user: { passwordHash: true }, adminUser: { passwordHash: true }, apiKey: { keyHash: true } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
