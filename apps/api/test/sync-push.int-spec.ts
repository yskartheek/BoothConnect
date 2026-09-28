import { randomUUID } from 'node:crypto';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { MutationResult } from '../src/sync/push.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic), in this file's own database: volunteer A works at station
// 1, volunteer B at station 2. Religion is disabled; caste needs consent.
const VOLUNTEER_A = '+919999900002';

type Mutation = { key: string; type: string; payload: object };
type Push = { results: MutationResult[] };

describe('POST /v1/sync/push (real Postgres)', () => {
  let t: TestApp;
  let a: SignedIn;
  let station1: string;
  let station2: string;
  let houses = 0;

  const key = () => `m-${randomUUID()}`;
  const push = (mutations: Mutation[], batchKey: string = randomUUID(), who: SignedIn = a) =>
    who.http.post('/v1/sync/push').set('Idempotency-Key', batchKey).send({ mutations });
  const pushed = async (mutations: Mutation[], batchKey?: string) =>
    ((await push(mutations, batchKey).expect(200)).body as Push).results;
  const statuses = (results: MutationResult[]) =>
    results.map((r) => (r.status === 'rejected' ? `rejected:${r.code}` : r.status));
  let next = 0;
  const freshVoter = async () => {
    const voters = await t.prisma.voter.findMany({
      where: { pollingStationId: station1, origin: 'official_import' },
      orderBy: { serialNo: 'desc' },
    });
    next += 1;
    return voters[next - 1]!;
  };
  const counts = async () => ({
    households: await t.prisma.household.count(),
    voters: await t.prisma.voter.count(),
    values: await t.prisma.fieldValue.count(),
    visits: await t.prisma.visit.count(),
    consents: await t.prisma.consent.count(),
    audit: await t.prisma.auditEvent.count(),
  });

  /**
   * The acceptance batch: a new household and a new member in it (by the
   * ids the phone made), a consent and the value it covers, an ordinary
   * edit, a visit to the new household, and three bad items.
   */
  const mixedBatch = async () => {
    const householdId = randomUUID();
    const memberId = randomUUID();
    const consentId = randomUUID();
    const voter = await freshVoter();
    houses += 1;
    return {
      householdId,
      memberId,
      voter,
      mutations: [
        {
          key: key(),
          type: 'household.create',
          payload: {
            id: householdId,
            pollingStationId: station1,
            address: { house_no: `P-${houses}`, street: 'Push Street' },
          },
        },
        {
          key: key(),
          type: 'member.create',
          payload: { householdId, id: memberId, name: 'Pushed Member', age: 40 },
        },
        {
          key: key(),
          type: 'consent.capture',
          payload: {
            id: consentId,
            voterId: memberId,
            purpose: 'caste_community',
            noticeVersion: '2026.1',
            method: 'in_person_verbal',
          },
        },
        {
          key: key(),
          type: 'field.change',
          payload: {
            entityType: 'voter',
            entityId: memberId,
            fieldKey: 'caste_community',
            value: 'Pushed Community',
            baseVersion: null,
            consentId,
          },
        },
        {
          key: key(),
          type: 'field.change',
          payload: {
            entityType: 'voter',
            entityId: voter.id,
            fieldKey: 'occupation',
            value: 'Pushed Job',
            baseVersion: null,
          },
        },
        {
          key: key(),
          type: 'visit.create',
          payload: {
            clientId: randomUUID(),
            householdId,
            startedAt: '2026-09-27T09:00:00.000Z',
            outcome: 'completed',
            formVersion: '2026.1',
            memberIdsMet: [memberId],
          },
        },
        // Bad items: a disabled field, a booth outside the scope, a malformed payload.
        {
          key: key(),
          type: 'field.change',
          payload: {
            entityType: 'voter',
            entityId: voter.id,
            fieldKey: 'religion',
            value: 'x',
            baseVersion: null,
          },
        },
        {
          key: key(),
          type: 'household.create',
          payload: { pollingStationId: station2, address: { house_no: `Q-${houses}` } },
        },
        { key: key(), type: 'visit.create', payload: { householdId, outcome: 'done' } },
      ],
    };
  };

  beforeAll(async () => {
    t = await createTestApp();
    const station = async (code: string) =>
      (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
        .id;
    station1 = await station('1');
    station2 = await station('2');
    a = await loginAs(t, VOLUNTEER_A);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a signed-in user, an Idempotency-Key and a well-formed batch', async () => {
    await t.http().post('/v1/sync/push').send({ mutations: [] }).expect(401);
    const res = await a.http.post('/v1/sync/push').send({ mutations: [] }).expect(400);
    expect((res.body as ApiErrorBody).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await push([]).expect(400);
    await push([{ key: 'short', type: 'visit.create', payload: {} }]).expect(400);
    await push([{ key: key(), type: 'nope', payload: {} }]).expect(400);
  });

  it('a mixed batch gives the right status per item; a new household and member work', async () => {
    const batch = await mixedBatch();
    const results = await pushed(batch.mutations);
    expect(statuses(results)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
      'applied',
      'applied',
      'rejected:FIELD_DISABLED',
      'rejected:NOT_FOUND',
      'rejected:VALIDATION_FAILED',
    ]);
    expect(results.map((r) => r.key)).toEqual(batch.mutations.map((m) => m.key));

    const household = await t.prisma.household.findUniqueOrThrow({
      where: { id: batch.householdId },
      include: { voters: true, visits: { include: { membersMet: true } } },
    });
    expect(household).toMatchObject({ origin: 'volunteer_added', pollingStationId: station1 });
    expect(household.voters.map((v) => v.id)).toEqual([batch.memberId]);
    expect(household.visits[0]?.membersMet.map((m) => m.voterId)).toEqual([batch.memberId]);
    const caste = await t.prisma.fieldValue.findFirstOrThrow({
      where: { entityId: batch.memberId, fieldDefinition: { key: 'caste_community' } },
    });
    expect(caste).toMatchObject({ value: 'Pushed Community', isCurrent: true });
    expect(
      await t.prisma.household.count({
        where: { pollingStationId: station2, houseKey: `Q-${houses}` },
      }),
    ).toBe(0);
    expect(results[8]?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'clientId' })]),
    );
  });

  it('replaying the same batch gives duplicates and stores nothing again', async () => {
    const batch = await mixedBatch();
    const batchKey = randomUUID();
    const first = await push(batch.mutations, batchKey).expect(200);
    const before = await counts();

    // The same request again (a lost response): the stored answer.
    const replay = await push(batch.mutations, batchKey).expect(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    // The phone's queue sent again in a new batch: each item is a duplicate.
    const again = await pushed(batch.mutations);
    expect(statuses(again)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
      'rejected:FIELD_DISABLED',
      'rejected:NOT_FOUND',
      'rejected:VALIDATION_FAILED',
    ]);
    const firstResults = (first.body as Push).results;
    expect(again[0]?.result).toEqual(firstResults[0]?.result);
    expect(await counts()).toEqual(before);
  });

  it('the same queue sent twice at once is stored once', async () => {
    const voter = await freshVoter();
    const items = ['A', 'B', 'C'].map((value) => ({
      key: key(),
      type: 'field.change',
      payload: {
        entityType: 'voter',
        entityId: voter.id,
        fieldKey: 'additional_info',
        value,
        baseVersion: null,
      },
    }));
    const [one, two] = await Promise.all([pushed(items), pushed(items)]);
    // Each item is stored by one request; the other reports it as a duplicate.
    one.forEach((r, i) => {
      expect([r.status, two[i]?.status].filter((s) => s === 'duplicate')).toHaveLength(1);
    });
    expect(
      await t.prisma.fieldValue.count({
        where: { entityId: voter.id, fieldDefinition: { key: 'additional_info' } },
      }),
    ).toBe(3);
  });

  it('a key reused for a different change is rejected', async () => {
    const voter = await freshVoter();
    const k = key();
    const change = (value: string) => ({
      key: k,
      type: 'field.change',
      payload: {
        entityType: 'voter',
        entityId: voter.id,
        fieldKey: 'occupation',
        value,
        baseVersion: null,
      },
    });
    expect(statuses(await pushed([change('One')]))).toEqual(['applied']);
    expect(statuses(await pushed([change('Two')]))).toEqual(['rejected:IDEMPOTENCY_KEY_REUSED']);
  });

  it('a stale field change is a conflict, with the server’s current values', async () => {
    const voter = await freshVoter();
    const change = (value: string, baseVersion: string | null) => ({
      key: key(),
      type: 'field.change',
      payload: {
        entityType: 'voter',
        entityId: voter.id,
        fieldKey: 'occupation',
        value,
        baseVersion,
      },
    });
    const [base] = await pushed([change('Base', null)]);
    const baseId = (base?.result as { fieldValueId: string }).fieldValueId;
    const results = await pushed([change('Phone one', baseId), change('Phone two', baseId)]);
    expect(statuses(results)).toEqual(['applied', 'conflict']);
    expect(results[1]?.current?.map((v) => v.value)).toEqual(['Phone one', 'Phone two']);
    expect(results[1]?.current?.[0]).toMatchObject({ collectedBy: { name: expect.any(String) } });

    // Resolved from the phone, then resolved again: a duplicate.
    const conflictId = (results[1]?.result as { fieldValueId: string }).fieldValueId;
    const resolve = () => ({
      key: key(),
      type: 'conflict.resolve',
      payload: { conflictId, keepFieldValueId: conflictId },
    });
    expect(statuses(await pushed([resolve()]))).toEqual(['applied']);
    expect(statuses(await pushed([resolve()]))).toEqual(['duplicate']);
    const current = await t.prisma.fieldValue.findMany({
      where: { entityId: voter.id, isCurrent: true, fieldDefinition: { key: 'occupation' } },
    });
    expect(current.map((v) => v.value)).toEqual(['Phone two']);
  });

  it('household.update applies, and a stale one is a conflict with the current address', async () => {
    const householdId = randomUUID();
    houses += 1;
    await pushed([
      {
        key: key(),
        type: 'household.create',
        payload: {
          id: householdId,
          pollingStationId: station1,
          address: { house_no: `U-${houses}` },
        },
      },
    ]);
    const base = await t.prisma.fieldValue.findFirstOrThrow({
      where: { entityId: householdId, fieldDefinition: { key: 'address' } },
    });
    const update = (street: string) => ({
      key: key(),
      type: 'household.update',
      payload: {
        id: householdId,
        address: { house_no: `U-${houses}`, street },
        addressBaseVersion: base.id,
      },
    });
    const results = await pushed([update('First'), update('Second')]);
    expect(statuses(results)).toEqual(['applied', 'conflict']);
    expect(results[1]?.current?.map((v) => (v.value as { street: string }).street)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('an item that fails part-way stores none of it', async () => {
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station1 },
    });
    const outsider = await t.prisma.voter.findFirstOrThrow({
      where: { pollingStationId: station2 },
    });
    const clientId = randomUUID();
    const [result] = await pushed([
      {
        key: key(),
        type: 'visit.create',
        payload: {
          clientId,
          householdId: household.id,
          startedAt: '2026-09-27T09:00:00.000Z',
          outcome: 'completed',
          formVersion: '2026.1',
          memberIdsMet: [outsider.id],
        },
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', code: 'UNPROCESSABLE' });
    expect(await t.prisma.visit.count({ where: { clientId } })).toBe(0);
  });
});
