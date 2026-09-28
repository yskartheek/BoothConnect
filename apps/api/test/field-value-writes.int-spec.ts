import type { Scope } from '../src/authz/scope.service';
import { ScopeService } from '../src/authz/scope.service';
import {
  type FieldChange,
  type FieldChangeResult,
  FieldValuesService,
} from '../src/field-values/field-values.service';
import { createTestApp, type TestApp } from './support/app';

// Seed (synthetic), in this file's own database: stations 1 (volunteer A) and
// 2 (volunteer B). Fields: name, age, gender, mobile_number, occupation,
// additional_info, caste_community (consent-gated); religion and political
// affiliation are disabled.
const VOLUNTEER_A = '+919999900002';

describe('FieldValuesService.write (real Postgres)', () => {
  let t: TestApp;
  let service: FieldValuesService;
  let scope: Scope;
  let volunteer: string;
  let station1: string;
  let station2: string;

  let next = 0;
  /** A roll voter at station 1 that no other test touches. */
  const freshVoter = async () => {
    const voters = await t.prisma.voter.findMany({
      where: { pollingStationId: station1, origin: 'official_import' },
      orderBy: { serialNo: 'desc' },
    });
    next += 1;
    return voters[next - 1]!;
  };
  const change = (
    voterId: string,
    fieldKey: string,
    value: unknown,
    extra: Partial<FieldChange> = {},
  ) =>
    ({
      entityType: 'voter',
      entityId: voterId,
      fieldKey,
      value,
      baseVersion: null,
      ...extra,
    }) as FieldChange;
  const write = (...changes: FieldChange[]) => service.write(scope, volunteer, changes);
  const one = async (c: FieldChange) => (await write(c))[0]!;
  const valuesOf = (entityId: string, key: string) =>
    t.prisma.fieldValue.findMany({
      where: { entityId, fieldDefinition: { key } },
      orderBy: { createdAt: 'asc' },
    });
  const consent = (voterId: string, purpose = 'caste_community') =>
    t.prisma.consent.create({
      data: {
        subjectVoterId: voterId,
        purpose,
        noticeVersion: 'test',
        capturedMethod: 'in_person_verbal',
        capturedById: volunteer,
      },
    });
  const applied = (result: FieldChangeResult) => {
    if (result.status !== 'applied')
      throw new Error(`expected applied, got ${JSON.stringify(result)}`);
    return result;
  };

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(FieldValuesService);
    volunteer = (await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } })).id;
    scope = await t.app.get(ScopeService).resolve(volunteer);
    const station = async (code: string) =>
      (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
        .id;
    station1 = await station('1');
    station2 = await station('2');
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('direct edits', () => {
    it('a first value is current immediately, and source_data is unchanged', async () => {
      const voter = await freshVoter();
      const result = applied(await one(change(voter.id, 'name', 'Edited Name')));
      expect(result.supersedesId).toBeNull();

      const [stored] = await valuesOf(voter.id, 'name');
      expect(stored).toMatchObject({
        id: result.fieldValueId,
        value: 'Edited Name',
        isCurrent: true,
        sourceType: 'volunteer_collected',
        collectedById: volunteer,
        conflictWithId: null,
      });
      const after = await t.prisma.voter.findUniqueOrThrow({ where: { id: voter.id } });
      expect(after.sourceData).toEqual(voter.sourceData);
    });

    it('an edit on the current value supersedes it; the old one stays as history', async () => {
      const voter = await freshVoter();
      const first = applied(await one(change(voter.id, 'occupation', 'Farmer')));
      const second = applied(
        await one(change(voter.id, 'occupation', 'Teacher', { baseVersion: first.fieldValueId })),
      );
      expect(second.supersedesId).toBe(first.fieldValueId);

      const rows = await valuesOf(voter.id, 'occupation');
      expect(rows.map((r) => [r.value, r.isCurrent])).toEqual([
        ['Farmer', false],
        ['Teacher', true],
      ]);
      expect(rows[1]).toMatchObject({
        supersedesId: first.fieldValueId,
        baseVersion: first.fieldValueId,
      });
    });
  });

  describe('conflicts (plan §8)', () => {
    it('two stale edits to the same field: a conflict, and neither value is lost', async () => {
      const voter = await freshVoter();
      const base = applied(await one(change(voter.id, 'mobile_number', '+919000000001')));

      // Two phones edited offline, both starting from `base`.
      const [a, b] = await write(
        change(voter.id, 'mobile_number', '+919000000002', { baseVersion: base.fieldValueId }),
        change(voter.id, 'mobile_number', '+919000000003', { baseVersion: base.fieldValueId }),
      );
      expect(a).toMatchObject({ status: 'applied', supersedesId: base.fieldValueId });
      expect(b).toMatchObject({
        status: 'conflict',
        conflictWithId: a?.status === 'applied' ? a.fieldValueId : '',
      });

      const current = (await valuesOf(voter.id, 'mobile_number')).filter((r) => r.isCurrent);
      expect(current.map((r) => r.value).sort()).toEqual(['+919000000002', '+919000000003']);
      // Nothing was overwritten: all three values are stored.
      expect(await valuesOf(voter.id, 'mobile_number')).toHaveLength(3);
    });

    it('an edit made without seeing the existing value is a conflict', async () => {
      const voter = await freshVoter();
      const existing = applied(await one(change(voter.id, 'age', 40)));
      await expect(one(change(voter.id, 'age', 41))).resolves.toMatchObject({
        status: 'conflict',
        conflictWithId: existing.fieldValueId,
      });
    });

    it('an edit while a conflict is open stays a conflict', async () => {
      const voter = await freshVoter();
      const base = applied(await one(change(voter.id, 'occupation', 'One')));
      const [newer] = await write(
        change(voter.id, 'occupation', 'Two', { baseVersion: base.fieldValueId }),
        change(voter.id, 'occupation', 'Three', { baseVersion: base.fieldValueId }),
      );
      const third = await one(
        change(voter.id, 'occupation', 'Four', {
          baseVersion: newer?.status === 'applied' ? newer.fieldValueId : null,
        }),
      );
      expect(third.status).toBe('conflict');
      const current = (await valuesOf(voter.id, 'occupation')).filter((r) => r.isCurrent);
      expect(current).toHaveLength(3);
    });

    it('a concurrent edit from the same base waits for the first, then conflicts', async () => {
      const voter = await freshVoter();
      const base = applied(await one(change(voter.id, 'additional_info', 'start')));
      const edit = (v: string) =>
        change(voter.id, 'additional_info', v, { baseVersion: base.fieldValueId });

      // The first edit has written but not committed when the second arrives.
      let release!: () => void;
      let written!: () => void;
      const wrote = new Promise<void>((resolve) => (written = resolve));
      const first = t.prisma.$transaction(async (tx) => {
        const results = await service.write(scope, volunteer, [edit('first')], tx);
        written();
        await new Promise<void>((resolve) => (release = resolve));
        return results;
      });
      await wrote;
      const second = one(edit('second'));
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();

      const [[a], b] = await Promise.all([first, second]);
      expect(a).toMatchObject({ status: 'applied', supersedesId: base.fieldValueId });
      expect(b).toMatchObject({
        status: 'conflict',
        conflictWithId: a?.status === 'applied' ? a.fieldValueId : '',
      });
    });
  });

  describe('rejections (nothing is stored)', () => {
    it('a disabled field: FIELD_DISABLED', async () => {
      const voter = await freshVoter();
      await expect(one(change(voter.id, 'religion', 'x'))).resolves.toMatchObject({
        status: 'rejected',
        code: 'FIELD_DISABLED',
      });
      expect(await valuesOf(voter.id, 'religion')).toEqual([]);
    });

    it('caste without a valid consent: CONSENT_REQUIRED', async () => {
      const voter = await freshVoter();
      const other = await freshVoter();
      const withdrawn = await consent(voter.id);
      await t.prisma.consent.update({
        where: { id: withdrawn.id },
        data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawnById: volunteer },
      });
      const cases: Partial<FieldChange>[] = [
        {},
        { consentId: withdrawn.id },
        { consentId: (await consent(other.id)).id }, // another person's consent
        { consentId: (await consent(voter.id, 'household_location')).id }, // another purpose
      ];
      for (const extra of cases) {
        await expect(one(change(voter.id, 'caste_community', 'X', extra))).resolves.toMatchObject({
          status: 'rejected',
          code: 'CONSENT_REQUIRED',
        });
      }
      expect(await valuesOf(voter.id, 'caste_community')).toEqual([]);

      const granted = await consent(voter.id);
      const result = applied(
        await one(change(voter.id, 'caste_community', 'X', { consentId: granted.id })),
      );
      const [stored] = await valuesOf(voter.id, 'caste_community');
      expect(stored).toMatchObject({ id: result.fieldValueId, consentId: granted.id });
    });

    it('values that do not fit the field: INVALID_VALUE', async () => {
      const voter = await freshVoter();
      for (const [key, value] of [
        ['gender', 'unknown'],
        ['age', 'forty'],
        ['age', Number.NaN],
        ['mobile_number', '98765'],
        ['name', '   '],
        ['name', 'x'.repeat(2001)],
        ['name', 42],
      ] as const) {
        await expect(one(change(voter.id, key, value))).resolves.toMatchObject({
          status: 'rejected',
          code: 'INVALID_VALUE',
        });
      }
    });

    it('an unknown field, a voter outside the scope, a base from another field', async () => {
      const voter = await freshVoter();
      await expect(one(change(voter.id, 'shoe_size', 'x'))).resolves.toMatchObject({
        code: 'FIELD_UNKNOWN',
      });

      const outside = await t.prisma.voter.findFirstOrThrow({
        where: { pollingStationId: station2 },
      });
      await expect(one(change(outside.id, 'name', 'Nope'))).resolves.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await valuesOf(outside.id, 'name')).toEqual([]);

      const age = applied(await one(change(voter.id, 'age', 30)));
      await expect(
        one(change(voter.id, 'name', 'Mixed', { baseVersion: age.fieldValueId })),
      ).resolves.toMatchObject({ code: 'BASE_VERSION_INVALID' });
    });
  });

  it('reports one result per change; a rejection does not stop the others', async () => {
    const voter = await freshVoter();
    const results = await write(
      change(voter.id, 'name', 'Batch Name'),
      change(voter.id, 'religion', 'x'),
      change(voter.id, 'age', 33),
    );
    expect(results.map((r) => r.status)).toEqual(['applied', 'rejected', 'applied']);
  });

  it('writes inside the caller’s transaction when given one', async () => {
    const voter = await freshVoter();
    await expect(
      t.prisma.$transaction(async (tx) => {
        const [result] = await service.write(
          scope,
          volunteer,
          [change(voter.id, 'name', 'Rolled')],
          tx,
        );
        expect(result?.status).toBe('applied');
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await valuesOf(voter.id, 'name')).toEqual([]);
  });

  it('writes household fields too', async () => {
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station1 },
      include: { part: true },
    });
    await t.prisma.fieldDefinition.create({
      data: {
        programId: household.part.programId,
        key: 'test_household_note',
        labelKey: 'field.test_household_note',
        appliesTo: 'household',
        type: 'text',
        purpose: 'Test',
        enabled: true,
      },
    });
    const [result] = await write({
      entityType: 'household',
      entityId: household.id,
      fieldKey: 'test_household_note',
      value: 'Blue gate',
      baseVersion: null,
    });
    expect(result?.status).toBe('applied');
    // A voter field doesn't apply to a household.
    await expect(
      one({
        entityType: 'household',
        entityId: household.id,
        fieldKey: 'name',
        value: 'x',
        baseVersion: null,
      }),
    ).resolves.toMatchObject({ code: 'FIELD_UNKNOWN' });
  });
});
