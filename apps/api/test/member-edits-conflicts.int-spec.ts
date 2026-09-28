import { randomUUID } from 'node:crypto';

import { ScopeService } from '../src/authz/scope.service';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { ConflictResolved } from '../src/conflicts/conflicts.service';
import { FieldValuesService } from '../src/field-values/field-values.service';
import type { HouseholdDetail } from '../src/households/households.service';
import type { MemberEdited } from '../src/voters/voter-writes.service';
import type { VoterDetail } from '../src/voters/voters.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic), in this file's own database: volunteer A works at station
// 1, volunteer B at station 2, the admin on the AC. Caste/community needs
// consent. Households have the `address` field.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';
const MANAGER = '+919999900113';

describe('member edits and conflict resolution (real Postgres)', () => {
  let t: TestApp;
  let a: SignedIn;
  let station1: string;
  let station2: string;
  let volunteerA: string;

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
  const edit = (voterId: string, fields: object[], who: SignedIn = a, key = randomUUID()) =>
    who.http.patch(`/v1/voters/${voterId}`).set('Idempotency-Key', key).send({ fields });
  const edited = async (voterId: string, fields: object[]) =>
    (await edit(voterId, fields).expect(200)).body as MemberEdited;
  const resolve = (conflictId: string, keepFieldValueId: string, who: SignedIn = a) =>
    who.http.post(`/v1/conflicts/${conflictId}/resolve`).send({ keepFieldValueId });
  const valuesOf = (entityId: string, key: string) =>
    t.prisma.fieldValue.findMany({
      where: { entityId, fieldDefinition: { key } },
      orderBy: { createdAt: 'asc' },
    });
  const idOf = (result: MemberEdited['fields'][number] | undefined) =>
    result && result.status !== 'rejected' ? result.fieldValueId : '';
  /** Two stale edits of one field: returns [applied value, conflicting value]. */
  const makeConflict = async (
    voterId: string,
    key: string,
    values: [unknown, unknown, unknown],
  ) => {
    const base = await edited(voterId, [{ fieldKey: key, value: values[0], baseVersion: null }]);
    const baseId = idOf(base.fields[0]);
    const first = await edited(voterId, [{ fieldKey: key, value: values[1], baseVersion: baseId }]);
    const second = await edited(voterId, [
      { fieldKey: key, value: values[2], baseVersion: baseId },
    ]);
    expect(first.fields[0]?.status).toBe('applied');
    expect(second.fields[0]?.status).toBe('conflict');
    return [idOf(first.fields[0]), idOf(second.fields[0])] as const;
  };

  beforeAll(async () => {
    t = await createTestApp();
    const station = async (code: string) =>
      (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
        .id;
    station1 = await station('1');
    station2 = await station('2');
    a = await loginAs(t, VOLUNTEER_A);
    volunteerA = a.userId;

    const admin = await t.prisma.appUser.findUniqueOrThrow({
      where: { phone: ADMIN },
      include: { roleAssignments: true },
    });
    await t.prisma.appUser.create({
      data: {
        organizationId: admin.organizationId,
        name: 'Test Manager',
        phone: MANAGER,
        roleAssignments: {
          create: {
            role: 'campaign_manager',
            geographyNodeId: admin.roleAssignments[0]!.geographyNodeId,
          },
        },
      },
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('PATCH /v1/voters/:id', () => {
    it('an edit is current immediately and source_data is unchanged', async () => {
      const voter = await freshVoter();
      const result = await edited(voter.id, [
        { fieldKey: 'name', value: 'Edited Name', baseVersion: null },
        { fieldKey: 'occupation', value: 'Weaver', baseVersion: null },
      ]);
      expect(result.fields.map((f) => [f.fieldKey, f.status])).toEqual([
        ['name', 'applied'],
        ['occupation', 'applied'],
      ]);

      const detail = (await a.http.get(`/v1/voters/${voter.id}`).expect(200)).body as VoterDetail;
      expect(detail.fields.find((f) => f.key === 'name')?.current[0]?.value).toBe('Edited Name');
      expect(detail.official).toEqual(voter.sourceData);
      const after = await t.prisma.voter.findUniqueOrThrow({ where: { id: voter.id } });
      expect(after.sourceData).toEqual(voter.sourceData);

      const [event] = await t.prisma.auditEvent.findMany({
        where: { action: 'voter.update', resourceId: voter.id },
      });
      expect(event?.metadata).toEqual({
        fields: [
          { key: 'name', status: 'applied' },
          { key: 'occupation', status: 'applied' },
        ],
      });
      expect(JSON.stringify(event?.metadata)).not.toContain('Weaver');
    });

    it('caste without consent is rejected with CONSENT_REQUIRED; with consent it applies', async () => {
      const voter = await freshVoter();
      const without = await edited(voter.id, [
        { fieldKey: 'caste_community', value: 'X', baseVersion: null },
      ]);
      expect(without.fields[0]).toMatchObject({ status: 'rejected', code: 'CONSENT_REQUIRED' });

      const consent = await t.prisma.consent.create({
        data: {
          subjectVoterId: voter.id,
          purpose: 'caste_community',
          noticeVersion: 'test',
          capturedMethod: 'in_person_verbal',
          capturedById: volunteerA,
        },
      });
      const withConsent = await edited(voter.id, [
        { fieldKey: 'caste_community', value: 'X', baseVersion: null, consentId: consent.id },
      ]);
      expect(withConsent.fields[0]?.status).toBe('applied');
    });

    it('two stale edits create a conflict; both values are kept', async () => {
      const voter = await freshVoter();
      await makeConflict(voter.id, 'occupation', ['Base', 'First', 'Second']);
      const current = (await valuesOf(voter.id, 'occupation')).filter((v) => v.isCurrent);
      expect(current.map((v) => v.value).sort()).toEqual(['First', 'Second']);
    });

    it('replaying the same edit stores one value', async () => {
      const voter = await freshVoter();
      const key = randomUUID();
      const fields = [{ fieldKey: 'occupation', value: 'Once', baseVersion: null }];
      await edit(voter.id, fields, a, key).expect(200);
      const again = await edit(voter.id, fields, a, key).expect(200);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect(await valuesOf(voter.id, 'occupation')).toHaveLength(1);
    });

    it('a voter outside the scope gets 404; a campaign manager gets 403', async () => {
      const outside = await t.prisma.voter.findFirstOrThrow({
        where: { pollingStationId: station2 },
      });
      const res = await edit(outside.id, [
        { fieldKey: 'name', value: 'x', baseVersion: null },
      ]).expect(404);
      expect((res.body as ApiErrorBody).code).toBe('NOT_FOUND');
      expect(await valuesOf(outside.id, 'name')).toEqual([]);

      const manager = await loginAs(t, MANAGER);
      const voter = await freshVoter();
      await edit(voter.id, [{ fieldKey: 'name', value: 'x', baseVersion: null }], manager).expect(
        403,
      );
    });

    it('rejects malformed edits with 400', async () => {
      const voter = await freshVoter();
      await edit(voter.id, []).expect(400);
      await edit(voter.id, [{ fieldKey: 'name', value: 'x' }]).expect(400);
      await edit(voter.id, [{ fieldKey: 'name', baseVersion: null }]).expect(400);
    });
  });

  describe('restricted fields on the write path', () => {
    it('a role that may not see caste cannot write it either', async () => {
      const voter = await freshVoter();
      const manager = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: MANAGER } });
      const scope = await t.app.get(ScopeService).resolve(manager.id);
      const [result] = await t.app.get(FieldValuesService).write(scope, manager.id, [
        {
          entityType: 'voter',
          entityId: voter.id,
          fieldKey: 'caste_community',
          value: 'X',
          baseVersion: null,
        },
      ]);
      expect(result).toMatchObject({ status: 'rejected', code: 'FIELD_UNKNOWN' });
    });
  });

  describe('POST /v1/conflicts/:id/resolve', () => {
    it('keeps the chosen value; the other stays in history; a second resolve is a no-op', async () => {
      const voter = await freshVoter();
      const [first, second] = await makeConflict(voter.id, 'occupation', ['B', 'Kept', 'Dropped']);

      const res = (await resolve(second, first).expect(200)).body as ConflictResolved;
      expect(res).toMatchObject({
        status: 'resolved',
        keptId: first,
        discardedIds: [second],
        entityId: voter.id,
        fieldKey: 'occupation',
      });

      const rows = await valuesOf(voter.id, 'occupation');
      const byId = (id: string) => rows.find((row) => row.id === id);
      expect(byId(first)).toMatchObject({ isCurrent: true, conflictWithId: null });
      expect(byId(second)).toMatchObject({ isCurrent: false, conflictWithId: null });

      const detail = (await a.http.get(`/v1/voters/${voter.id}?history=true`).expect(200))
        .body as VoterDetail;
      const occupation = detail.fields.find((f) => f.key === 'occupation');
      expect(occupation?.current.map((v) => v.value)).toEqual(['Kept']);
      expect(occupation?.history?.map((v) => v.value).sort()).toEqual(['B', 'Dropped']);

      const events = () =>
        t.prisma.auditEvent.count({ where: { action: 'conflict.resolve', resourceId: voter.id } });
      expect(await events()).toBe(1);
      const again = (await resolve(second, first).expect(200)).body as ConflictResolved;
      expect(again).toEqual({ status: 'already_resolved', keptId: first });
      expect(await events()).toBe(1);
    });

    it('can keep the newer (conflicting) value instead', async () => {
      const voter = await freshVoter();
      const [first, second] = await makeConflict(voter.id, 'additional_info', ['B', 'Old', 'New']);
      await resolve(first, second).expect(200);
      const current = (await valuesOf(voter.id, 'additional_info')).filter((v) => v.isCurrent);
      expect(current.map((v) => v.value)).toEqual(['New']);
    });

    it('the value to keep must be one of the conflicting values', async () => {
      const voter = await freshVoter();
      const [first] = await makeConflict(voter.id, 'occupation', ['Base', 'A', 'B']);
      const base = (await valuesOf(voter.id, 'occupation')).find((v) => v.value === 'Base')!;
      const res = await resolve(first, base.id).expect(409);
      expect((res.body as ApiErrorBody).code).toBe('CONFLICT');
      await resolve(first, randomUUID()).expect(409);
    });

    it('only someone scoped to the booth can resolve it', async () => {
      const voter = await freshVoter();
      const [first, second] = await makeConflict(voter.id, 'occupation', ['B', 'X', 'Y']);
      const b = await loginAs(t, VOLUNTEER_B);
      await resolve(second, first, b).expect(404);
      await resolve(second, first, await loginAs(t, MANAGER)).expect(403);
      await resolve(randomUUID(), first).expect(404);
      // Still open.
      expect((await valuesOf(voter.id, 'occupation')).filter((v) => v.isCurrent)).toHaveLength(2);

      await resolve(second, first, await loginAs(t, ADMIN)).expect(200);
    });

    it('resolving an address conflict updates the household to the kept address', async () => {
      const household = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station1, origin: 'official_import' },
        orderBy: { id: 'desc' },
      });
      const patch = (street: string, addressBaseVersion: string | null) =>
        a.http
          .patch(`/v1/households/${household.id}`)
          .set('Idempotency-Key', randomUUID())
          .send({ address: { house_no: household.houseKey, street }, addressBaseVersion })
          .expect(200);
      const base = await patch('Base Street', null);
      const baseId = (base.body as { results: { address: { fieldValueId: string } } }).results
        .address.fieldValueId;
      const applied = await patch('Applied Street', baseId);
      const conflicting = await patch('Chosen Street', baseId);
      const conflictId = (
        conflicting.body as { results: { address: { fieldValueId: string; status: string } } }
      ).results.address;
      expect(conflictId.status).toBe('conflict');
      expect((applied.body as { household: HouseholdDetail }).household.displayAddress).toContain(
        'Applied Street',
      );

      await resolve(conflictId.fieldValueId, conflictId.fieldValueId).expect(200);
      const detail = (await a.http.get(`/v1/households/${household.id}`).expect(200))
        .body as HouseholdDetail;
      expect(detail.displayAddress).toBe(`${household.houseKey}, Chosen Street`);
    });

    it('rejects a malformed request with 400', async () => {
      await a.http.post(`/v1/conflicts/${randomUUID()}/resolve`).send({}).expect(400);
      await a.http
        .post('/v1/conflicts/nope/resolve')
        .send({ keepFieldValueId: randomUUID() })
        .expect(400);
    });
  });
});
