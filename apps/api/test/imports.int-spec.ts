import { createHash } from 'node:crypto';

import type { PrismaService } from '../src/database/prisma.service';
import { connectDatabase, expectDbError, inRollback, type Tx } from './support/database';
import { createTree, createUser } from './support/fixtures';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('import tables (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await connectDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  async function setup(tx: Tx) {
    const tree = await createTree(tx);
    const admin = await createUser(tx, tree.orgId, 'Admin');
    const batch = await tx.importBatch.create({
      data: { programId: tree.programId, targetNodeId: tree.ac.id, uploadedById: admin.id },
    });
    const addFile = (checksum: string, extra: Record<string, unknown> = {}) =>
      tx.importFile.create({
        data: {
          batchId: batch.id,
          programId: tree.programId,
          fileRef: `imports/${batch.id}/${checksum}.pdf`,
          originalName: 'roll.pdf',
          sizeBytes: 8_000_000n,
          checksum,
          ...extra,
        },
      });
    return { tree, admin, batch, addFile };
  }

  it('accepts a batch at State, PC, AC or Part level, but not at a polling station', async () => {
    await inRollback(prisma, async (tx) => {
      const { tree, admin } = await setup(tx);
      for (const node of [tree.state, tree.pc, tree.part408]) {
        await tx.importBatch.create({
          data: { programId: tree.programId, targetNodeId: node.id, uploadedById: admin.id },
        });
      }
      await expectDbError(
        tx,
        () =>
          tx.importBatch.create({
            data: {
              programId: tree.programId,
              targetNodeId: tree.ps408.id,
              uploadedById: admin.id,
            },
          }),
        /target must be a state or pc or ac or part node, not polling_station/,
      );
    });
  });

  it("only lets a file's part be a part inside the batch's target", async () => {
    await inRollback(prisma, async (tx) => {
      const { tree, admin, addFile } = await setup(tx);
      await addFile(sha('ok'), { partNodeId: tree.part409.id });

      const partBatch = await tx.importBatch.create({
        data: { programId: tree.programId, targetNodeId: tree.part408.id, uploadedById: admin.id },
      });
      await expectDbError(
        tx,
        () =>
          tx.importFile.create({
            data: {
              batchId: partBatch.id,
              programId: tree.programId,
              fileRef: 'x',
              originalName: 'roll.pdf',
              sizeBytes: 1n,
              checksum: sha('other part'),
              partNodeId: tree.part409.id,
            },
          }),
        /part must be inside the batch's target/,
      );
      await expectDbError(
        tx,
        () => addFile(sha('station'), { partNodeId: tree.ps408.id }),
        /part must be a part node, not polling_station/,
      );
    });
  });

  it('allows a checksum only once among live files, but keeps duplicates and rejected uploads', async () => {
    await inRollback(prisma, async (tx) => {
      const { addFile } = await setup(tx);
      const checksum = sha('part 408 roll');
      const original = await addFile(checksum);

      await expectDbError(tx, () => addFile(checksum), /Unique constraint/);
      await addFile(checksum, { status: 'duplicate', duplicateOfId: original.id });
      await expectDbError(
        tx,
        () => addFile(checksum, { status: 'duplicate' }),
        /import_file_duplicate_check/,
      );

      // A rejected file (e.g. uploaded under the wrong AC) can be uploaded again.
      const other = sha('part 409 roll');
      await addFile(other, { status: 'rejected' });
      await addFile(other);
    });
  });

  it('rejects checksums that are not SHA-256 hex', async () => {
    await inRollback(prisma, async (tx) => {
      const { addFile } = await setup(tx);
      await expectDbError(tx, () => addFile('not-a-checksum'), /import_file_checksum_format_check/);
    });
  });

  it('chains source versions of a part and keeps each version once', async () => {
    await inRollback(prisma, async (tx) => {
      const { tree } = await setup(tx);
      const version = (checksum: string, previousVersionId?: string) =>
        tx.sourceVersion.create({
          data: {
            programId: tree.programId,
            partNodeId: tree.part408.id,
            revisionYear: 2026,
            revisionType: 'Special Intensive Revision 2026',
            rollIdentification: 'Draft Electoral Roll of Special Intensive Revision, 2026',
            publishedOn: new Date('2026-08-17'),
            checksum,
            previousVersionId,
          },
        });
      const draft = await version(sha('draft'));
      const final = await version(sha('final'), draft.id);
      const chain = await tx.sourceVersion.findUnique({
        where: { id: final.id },
        include: { previousVersion: true },
      });
      expect(chain?.previousVersion?.id).toBe(draft.id);

      await expectDbError(tx, () => version(sha('draft')), /Unique constraint/);
      await expectDbError(
        tx,
        () =>
          tx.sourceVersion.create({
            data: {
              programId: tree.programId,
              partNodeId: tree.ac.id,
              revisionYear: 2026,
              revisionType: 'x',
              rollIdentification: 'x',
              checksum: sha('ac'),
            },
          }),
        /part must be a part node, not ac/,
      );
    });
  });

  it('stores one row result per page position, with extracted values and confidence', async () => {
    await inRollback(prisma, async (tx) => {
      const { addFile } = await setup(tx);
      const file = await addFile(sha('rows'));
      const row = {
        importFileId: file.id,
        page: 3,
        boxIndex: 0,
        sectionNo: 1,
        serialNo: 1,
        status: 'accepted' as const,
        rawText:
          'Name : Test Voter | Fathers Name: Test Parent | House Number : 1-1 | Age : 30 Gender : Female',
        extractedValues: { epic: 'TST0000001', name: 'Test Voter', age: 30, gender: 'female' },
        fieldConfidence: { epic: 0.97, name: 0.93 },
      };
      await tx.importRowResult.create({ data: row });
      await expectDbError(tx, () => tx.importRowResult.create({ data: row }), /Unique constraint/);
      await expectDbError(
        tx,
        () => tx.importRowResult.create({ data: { ...row, page: 0, boxIndex: 5 } }),
        /import_row_result_position_check/,
      );
    });
  });
});
