import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://ars2fa:ars2fa@localhost:5432/ars2fa?schema=public' }) });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@ars2fa.baro.me';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(password, 12),
      name: 'ARS2FA Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });

  console.log(`Seeded admin user: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
