// Development seed data (#26). Run with `pnpm --filter api db:seed`, or
// automatically after `pnpm --filter api db:reset`. Safe to run again.
import { PrismaPg } from '@prisma/adapter-pg';

import { seedDatabase } from '../src/database/seed/seed';
import { PrismaClient } from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy infra/env/.env.example to .env first.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

seedDatabase(prisma)
  .then((summary) => {
    console.warn('Seed data is in place:', summary);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
