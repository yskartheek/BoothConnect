import type { PrismaService } from '../src/database/prisma.service';
import { connectDatabase, expectDbError, inRollback, type Tx } from './support/database';
import {
  createHousehold,
  createImportedPart,
  createTree,
  createUser,
  createVoter,
} from './support/fixtures';

// Needs a migrated database: `pnpm infra:up`, then `pnpm --filter api db:deploy`.
describe('field definitions and values (real Postgres)', () => {
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
    const voter = await createVoter(tx, {
      programId: tree.programId,
      householdId: household.id,
      partId: tree.part408.id,
      pollingStationId: tree.ps408.id,
      sourceVersionId: sourceVersion.id,
      importFileId: file.id,
      serialNo: 1,
    });
    const volunteer = await createUser(tx, tree.orgId, 'Volunteer');
    const field = (key: string, extra: Record<string, unknown> = {}) =>
      tx.fieldDefinition.create({
        data: {
          programId: tree.programId,
          key,
          labelKey: `field.${key}`,
          appliesTo: 'voter',
          type: 'text',
          purpose: 'Test purpose',
          enabled: true,
          ...extra,
        },
      });
    const value = (fieldDefinitionId: string, v: unknown, extra: Record<string, unknown> = {}) =>
      tx.fieldValue.create({
        data: {
          entityType: 'voter',
          entityId: voter.id,
          fieldDefinitionId,
          value: v as object,
          sourceType: 'volunteer_collected',
          collectedById: volunteer.id,
          ...extra,
        },
      });
    return { tree, household, voter, field, value };
  }

  /** The "current value(s)" query the API will use. */
  function currentValues(tx: Tx, entityId: string, fieldDefinitionId: string) {
    return tx.fieldValue.findMany({
      where: { entityType: 'voter', entityId, fieldDefinitionId, isCurrent: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  it('follows a history chain through supersedes_id and keeps one current value', async () => {
    await inRollback(prisma, async (tx) => {
      const { voter, field, value } = await setup(tx);
      const phone = await field('mobile_number');
      const v1 = await value(phone.id, '+919000000001');
      const v2 = await value(phone.id, '+919000000002', {
        supersedesId: v1.id,
        baseVersion: v1.id,
      });
      const v3 = await value(phone.id, '+919000000003', {
        supersedesId: v2.id,
        baseVersion: v2.id,
      });

      const current = await currentValues(tx, voter.id, phone.id);
      expect(current.map((c) => c.value)).toEqual(['+919000000003']);

      const history: unknown[] = [];
      let cursor: string | null = v3.id;
      while (cursor) {
        const row: { value: unknown; supersedesId: string | null } =
          await tx.fieldValue.findUniqueOrThrow({
            where: { id: cursor },
          });
        history.push(row.value);
        cursor = row.supersedesId;
      }
      expect(history).toEqual(['+919000000003', '+919000000002', '+919000000001']);
    });
  });

  it('keeps both values of a conflict current until it is resolved', async () => {
    await inRollback(prisma, async (tx) => {
      const { voter, field, value } = await setup(tx);
      const language = await field('preferred_language');
      const base = await value(language.id, 'te');
      await value(language.id, 'hi', { supersedesId: base.id, baseVersion: base.id });
      // A second, stale edit based on the same version: stored as a conflicting proposal.
      await value(language.id, 'en', { baseVersion: base.id });
      await expectDbError(
        tx,
        () => value(language.id, 'ur', { supersedesId: base.id, baseVersion: base.id }),
        /Unique constraint/,
      );
      const current = await currentValues(tx, voter.id, language.id);
      expect(current.map((c) => c.value).sort()).toEqual(['en', 'hi']);
    });
  });

  it('rejects values for disabled fields, wrong entity types and missing entities', async () => {
    await inRollback(prisma, async (tx) => {
      const { household, field, value } = await setup(tx);
      const disabled = await field('occupation', { enabled: false });
      await expectDbError(tx, () => value(disabled.id, 'farmer'), /"occupation" is disabled/);

      const householdField = await field('house_type', { appliesTo: 'household' });
      await expectDbError(
        tx,
        () => value(householdField.id, 'pucca'),
        /applies to household, not voter/,
      );
      await tx.fieldValue.create({
        data: {
          entityType: 'household',
          entityId: household.id,
          fieldDefinitionId: householdField.id,
          value: 'pucca',
          sourceType: 'volunteer_collected',
        },
      });

      const ok = await field('notes');
      await expectDbError(
        tx,
        () => value(ok.id, 'x', { entityId: '00000000-0000-7000-8000-000000000000' }),
        /Foreign key constraint violated/,
      );
    });
  });

  it('requires consent where configured, and a legal basis before a restricted field is enabled', async () => {
    await inRollback(prisma, async (tx) => {
      const { field, value } = await setup(tx);
      const email = await field('email', { requiresConsent: true });
      await expectDbError(tx, () => value(email.id, 'a@example.org'), /requires a consent record/);

      // Seeded restricted fields are disabled; enabling needs consent + legal basis.
      await field('religion', { isRestricted: true, enabled: false });
      await expectDbError(
        tx,
        () => field('caste', { isRestricted: true, enabled: true, requiresConsent: true }),
        /field_definition_restricted_enable_check/,
      );
    });
  });

  it('is append-only: values can be verified, but not edited or deleted', async () => {
    await inRollback(prisma, async (tx) => {
      const { field, value } = await setup(tx);
      const phone = await field('mobile_number');
      const v1 = await value(phone.id, '+919000000001');
      const verified = await tx.fieldValue.update({
        where: { id: v1.id },
        data: { verificationStatus: 'verified' },
      });
      expect(verified.verificationStatus).toBe('verified');
      await expectDbError(
        tx,
        () => tx.fieldValue.update({ where: { id: v1.id }, data: { value: '+919999999999' } }),
        /append-only/,
      );
      await expectDbError(
        tx,
        () => tx.fieldValue.delete({ where: { id: v1.id } }),
        /can't be deleted/,
      );
    });
  });

  it('refuses to replace a value of another field', async () => {
    await inRollback(prisma, async (tx) => {
      const { field, value } = await setup(tx);
      const a = await field('field_a');
      const b = await field('field_b');
      const va = await value(a.id, 'x');
      await expectDbError(
        tx,
        () => value(b.id, 'y', { supersedesId: va.id }),
        /same entity and field/,
      );
    });
  });
});
