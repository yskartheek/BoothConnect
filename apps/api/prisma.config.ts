import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 doesn't read .env files itself. Use the same files as the API:
// apps/api/.env first, then the repository-root .env. Real environment
// variables win over both.
loadEnv({ path: [join(__dirname, '.env'), join(__dirname, '..', '..', '.env')], quiet: true });

export default defineConfig({
  schema: join('prisma', 'schema.prisma'),
  migrations: {
    path: join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not needed for `prisma generate`, so a missing value only fails the
    // commands that talk to the database.
    url: process.env.DATABASE_URL ?? '',
  },
});
