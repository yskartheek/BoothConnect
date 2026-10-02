import type { PrismaService } from '../src/database/prisma.service';
import { SEED, SEED_VOTER, seedDatabase } from '../src/database/seed/seed';
import { connectDatabase, inRollback } from './support/database';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('development seed (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates the plan §7 dataset and changes nothing when run again', async () => {
    const [first, second] = await inRollback(prisma, async (tx) => [
      await seedDatabase(tx),
      await seedDatabase(tx),
    ]);
    expect(first).toEqual({
      geographyNodes: 8, // state, PC, AC, 2 parts, 2 main stations + 1 auxiliary
      users: 3,
      households: 40,
      voters: 121, // 120 from the roll + 1 added by a volunteer
      fieldDefinitions: 11,
      fieldValues: 6,
      consents: 4, // 3 household locations, the demo voter's caste / community
    });
    expect(second).toEqual(first);
  });

  it('follows spec v1.1 and keeps the data synthetic', async () => {
    await inRollback(prisma, async (tx) => {
      await seedDatabase(tx);
      const fields = await tx.fieldDefinition.findMany({ orderBy: { key: 'asc' } });
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
      expect(byKey.caste_community).toMatchObject({
        enabled: true,
        requiresConsent: true,
        isRestricted: true,
      });
      expect(byKey.religion?.enabled).toBe(false);
      expect(byKey.political_affiliation?.enabled).toBe(false);
      for (const key of [
        'name',
        'age',
        'gender',
        'mobile_number',
        'occupation',
        'additional_info',
      ]) {
        expect(byKey[key]?.enabled).toBe(true);
      }

      const voters = await tx.voter.findMany({
        where: { program: { name: 'Demo General Election 2026' } },
      });
      const official = voters.filter((v) => v.origin === 'official_import');
      expect(official.every((v) => /^DMO\d{7}$/.test(v.sourceVoterId ?? ''))).toBe(true);
      expect(voters.filter((v) => v.origin === 'volunteer_added')).toHaveLength(1);

      const phones = (
        await tx.appUser.findMany({ where: { phone: { in: Object.values(SEED) } } })
      ).map((u) => u.phone);
      expect(phones.sort()).toEqual(Object.values(SEED).sort());

      // Section 2 of part 1 votes at the auxiliary station 1A.
      const aux = await tx.geographyNode.findFirstOrThrow({
        where: { code: '1A', isAuxiliary: true },
      });
      expect(await tx.voter.count({ where: { pollingStationId: aux.id } })).toBe(30);
      expect(
        await tx.household.count({ where: { locationConsentId: { not: null } } }),
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it('has a demo voter who can sign in, with a detail shared by consent', async () => {
    await inRollback(prisma, async (tx) => {
      await seedDatabase(tx);
      const voter = await tx.voter.findFirstOrThrow({
        where: { sourceVoterId: SEED_VOTER.epic },
      });
      const values = await tx.fieldValue.findMany({
        where: { entityId: voter.id, isCurrent: true },
        include: { fieldDefinition: true, consent: true },
      });
      const byKey = Object.fromEntries(values.map((v) => [v.fieldDefinition.key, v]));
      // Voter sign-in matches the EPIC and the mobile number on record.
      expect(byKey.mobile_number?.value).toBe(SEED_VOTER.phone);
      expect(byKey.caste_community?.consent).toMatchObject({
        subjectVoterId: voter.id,
        purpose: 'caste_community',
        status: 'granted',
      });
      // The phone isn't a staff member's.
      expect(await tx.appUser.count({ where: { phone: SEED_VOTER.phone } })).toBe(0);
    });
  });
});
