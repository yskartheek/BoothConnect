import { Test } from '@nestjs/testing';

import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('database (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('has the baseline migration applied', async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(rows.map((row) => row.migration_name)).toContain('20260927000000_init');
  });

  it('uses UTC as the session time zone', async () => {
    const [row] = await prisma.$queryRaw<{ TimeZone: string }[]>`SHOW timezone`;
    expect(row?.TimeZone).toBe('UTC');
  });
});
