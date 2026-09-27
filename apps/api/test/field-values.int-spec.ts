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

  it('records a conflict, keeps both values current, and resolves it by the volunteer’s choice', async () => {
    await inRollback(prisma, async (tx) => {
      const { voter, field, value } = await setup(tx);
      const language = await field('preferred_language');
      const base = await value(language.id, 'te');
      // Volunteer A's offline edit arrives first and becomes current straight away.
      const edited = await value(language.id, 'hi', {
        supersedesId: base.id,
        baseVersion: base.id,
      });
      // Volunteer B edited the same starting value offline: stored as a conflict.
      const conflicting = await value(language.id, 'en', {
        baseVersion: base.id,
        conflictWithId: edited.id,
      });
      expect((await currentValues(tx, voter.id, language.id)).map((c) => c.value).sort()).toEqual([
        'en',
        'hi',
      ]);

      // B chooses A's value: B's value leaves the current set and the conflict is cleared.
      await tx.fieldValue.update({
        where: { id: conflicting.id },
        data: { isCurrent: false, conflictWithId: null },
      });
      const current = await currentValues(tx, voter.id, language.id);
      expect(current.map((c) => c.value)).toEqual(['hi']);
      // Both values stay in history.
      expect(
        await tx.fieldValue.count({
          where: { entityId: voter.id, fieldDefinitionId: language.id },
        }),
      ).toBe(3);
    });
  });

  it('refuses a second replacement of the same value and conflicts across fields', async () => {
    await inRollback(prisma, async (tx) => {
      const { field, value } = await setup(tx);
      const a = await field('field_a');
      const b = await field('field_b');
      const va = await value(a.id, 'x');
      await value(a.id, 'y', { supersedesId: va.id });
      await expectDbError(tx, () => value(a.id, 'z', { supersedesId: va.id }), /Unique constraint/);
      await expectDbError(
        tx,
        () => value(b.id, 'w', { conflictWithId: va.id }),
        /conflict with a value of the same entity and field/,
      );
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

  it('is append-only: only is_current (true → false) and conflict clearing may change', async () => {
    await inRollback(prisma, async (tx) => {
      const { field, value } = await setup(tx);
      const phone = await field('mobile_number');
      const v1 = await value(phone.id, '+919000000001');
      const v2 = await value(phone.id, '+919000000002', { conflictWithId: v1.id });
      await expectDbError(
        tx,
        () => tx.fieldValue.update({ where: { id: v1.id }, data: { value: '+919999999999' } }),
        /append-only/,
      );
      await tx.fieldValue.update({ where: { id: v2.id }, data: { conflictWithId: null } });
      await expectDbError(
        tx,
        () => tx.fieldValue.update({ where: { id: v2.id }, data: { conflictWithId: v1.id } }),
        /append-only/,
      );
      await tx.fieldValue.update({ where: { id: v1.id }, data: { isCurrent: false } });
      await expectDbError(
        tx,
        () => tx.fieldValue.update({ where: { id: v1.id }, data: { isCurrent: true } }),
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
