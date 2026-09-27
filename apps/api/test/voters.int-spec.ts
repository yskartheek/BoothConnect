import type { PrismaService } from '../src/database/prisma.service';
import { connectDatabase, expectDbError, inRollback, type Tx } from './support/database';
import { createHousehold, createImportedPart, createTree, createVoter } from './support/fixtures';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('households and voters (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function setup(tx: Tx) {
    const tree = await createTree(tx);
    const { sourceVersion, file } = await createImportedPart(tx, tree, tree.part408);
    const household = await createHousehold(
      tx,
      tree.part408.id,
      tree.ps408.id,
      sourceVersion.id,
      '4-76',
    );
    const base = {
      programId: tree.programId,
      householdId: household.id,
      partId: tree.part408.id,
      pollingStationId: tree.ps408.id,
      sourceVersionId: sourceVersion.id,
      importFileId: file.id,
    };
    const voter = await createVoter(tx, { ...base, serialNo: 1 });
    return { tree, sourceVersion, file, household, base, voter };
  }

  it("refuses to change a voter's source data, but allows status changes", async () => {
    await inRollback(prisma, async (tx) => {
      const { voter } = await setup(tx);
      await expectDbError(
        tx,
        () =>
          tx.voter.update({
            where: { id: voter.id },
            data: {
              sourceData: { name: 'Changed', age: 31, gender: 'female', relationType: 'father' },
            },
          }),
        /source data is the official record/,
      );
      await expectDbError(
        tx,
        () => tx.voter.update({ where: { id: voter.id }, data: { sourceVoterId: 'TST9999999' } }),
        /source data is the official record/,
      );
      const verified = await tx.voter.update({
        where: { id: voter.id },
        data: { verificationStatus: 'verified' },
      });
      expect(verified.verificationStatus).toBe('verified');
    });
  });

  it('lets a voter move to an auxiliary station of the same part, but not elsewhere', async () => {
    await inRollback(prisma, async (tx) => {
      const { tree, voter } = await setup(tx);
      const moved = await tx.voter.update({
        where: { id: voter.id },
        data: { pollingStationId: tree.ps408a.id },
      });
      expect(moved.pollingStationId).toBe(tree.ps408a.id);
      await expectDbError(
        tx,
        () =>
          tx.voter.update({ where: { id: voter.id }, data: { pollingStationId: tree.ps409.id } }),
        /must be a station of its part/,
      );
    });
  });

  it("keeps a voter's household and revision inside the voter's part", async () => {
    await inRollback(prisma, async (tx) => {
      const { tree, base } = await setup(tx);
      const other = await createImportedPart(tx, tree, tree.part409);
      const otherHousehold = await createHousehold(
        tx,
        tree.part409.id,
        tree.ps409.id,
        other.sourceVersion.id,
        '9-1',
      );
      await expectDbError(
        tx,
        () => createVoter(tx, { ...base, householdId: otherHousehold.id, serialNo: 2 }),
        /household must be in the voter's part/,
      );
      await expectDbError(
        tx,
        () => createVoter(tx, { ...base, sourceVersionId: other.sourceVersion.id, serialNo: 3 }),
        /source version must be a revision of the voter's part/,
      );
      await expectDbError(
        tx,
        () => createHousehold(tx, tree.part408.id, tree.ps409.id, base.sourceVersionId, '1-1'),
        /must be a station of its part/,
      );
    });
  });

  it('keeps EPIC and serial number unique within a revision, but not across revisions', async () => {
    await inRollback(prisma, async (tx) => {
      const { tree, base, voter } = await setup(tx);
      await expectDbError(
        tx,
        () => createVoter(tx, { ...base, serialNo: 2, sourceVoterId: voter.sourceVoterId }),
        /Unique constraint/,
      );
      await expectDbError(tx, () => createVoter(tx, { ...base, serialNo: 1 }), /Unique constraint/);

      const next = await createImportedPart(tx, tree, tree.part408, base.sourceVersionId);
      const again = await createVoter(tx, {
        ...base,
        sourceVersionId: next.sourceVersion.id,
        importFileId: next.file.id,
        serialNo: 1,
        sourceVoterId: voter.sourceVoterId,
      });
      expect(again.sourceVoterId).toBe(voter.sourceVoterId);
    });
  });

  it('uses the station index for the volunteer list query', async () => {
    const plan = await inRollback(prisma, async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT * FROM voter
          WHERE polling_station_id = '00000000-0000-7000-8000-000000000000' AND record_status = 'active'`,
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('voter_polling_station_id_record_status_idx');
  });
});
