import { randomUUID } from 'node:crypto';

import { AuditService } from '../src/audit/audit.service';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { VisitCreated } from '../src/visits/visits.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic), in this file's own database: volunteer A works at station
// 1, volunteer B at station 2. Each roll household has three members.
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';

describe('POST /v1/visits (real Postgres)', () => {
  let t: TestApp;
  let a: SignedIn;
  let station1: string;
  let station2: string;
  let next = 0;

  const station = async (code: string) =>
    (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
      .id;
  /** A new station-1 household with three members, for one test only. */
  const freshHousehold = async () => {
    next += 1;
    const template = await t.prisma.voter.findFirstOrThrow({
      where: { pollingStationId: station1 },
    });
    const member = {
      programId: template.programId,
      partId: template.partId,
      pollingStationId: station1,
      origin: 'volunteer_added' as const,
    };
    return t.prisma.household.create({
      data: {
        partId: template.partId,
        pollingStationId: station1,
        houseKey: `T-${next}`,
        displayAddress: `Test house ${next}`,
        origin: 'volunteer_added',
        voters: { create: [member, member, member] },
      },
      include: { voters: { orderBy: { id: 'asc' } } },
    });
  };
  const body = (householdId: string, extra: Record<string, unknown> = {}) => ({
    clientId: randomUUID(),
    householdId,
    startedAt: '2026-09-20T10:00:00.000Z',
    completedAt: '2026-09-20T10:15:00.000Z',
    outcome: 'completed',
    formVersion: '2026.1',
    ...extra,
  });
  const post = (who: SignedIn, payload: object, key: string = randomUUID()) =>
    who.http.post('/v1/visits').set('Idempotency-Key', key).send(payload);

  beforeAll(async () => {
    t = await createTestApp();
    station1 = await station('1');
    station2 = await station('2');
    a = await loginAs(t, VOLUNTEER_A);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a signed-in user and an Idempotency-Key', async () => {
    const household = await freshHousehold();
    await t.http().post('/v1/visits').send(body(household.id)).expect(401);
    const res = await a.http.post('/v1/visits').send(body(household.id)).expect(400);
    expect((res.body as ApiErrorBody).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('stores the visit with the members met, and records an audit event', async () => {
    const household = await freshHousehold();
    const [first, second] = household.voters;
    const res = await post(
      a,
      body(household.id, { memberIdsMet: [first!.id, second!.id], notes: 'Met two' }),
    ).expect(201);
    const visit = res.body as VisitCreated;
    expect(visit).toMatchObject({
      householdId: household.id,
      outcome: 'completed',
      duplicate: false,
      consents: [],
      fieldChanges: [],
    });

    const stored = await t.prisma.visit.findUniqueOrThrow({
      where: { id: visit.id },
      include: { membersMet: true },
    });
    expect(stored).toMatchObject({
      volunteerId: a.userId,
      notes: 'Met two',
      formVersion: '2026.1',
    });
    expect(stored.membersMet.map((m) => m.voterId).sort()).toEqual([first!.id, second!.id].sort());

    const events = await t.prisma.auditEvent.findMany({
      where: { action: 'visit.create', resourceId: visit.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      resourceType: 'visit',
      result: 'success',
      actorId: a.userId,
      metadata: expect.objectContaining({ householdId: household.id, outcome: 'completed' }),
    });
    await expect(t.app.get(AuditService).verifyChain()).resolves.toBeNull();

    // The household now shows as visited.
    const detail = await a.http.get(`/v1/households/${household.id}`).expect(200);
    expect((detail.body as { lastVisit: { id: string } }).lastVisit.id).toBe(visit.id);
  });

  describe('idempotency (plan §8)', () => {
    it('the same request twice stores one visit and returns the same response', async () => {
      const household = await freshHousehold();
      const payload = body(household.id, {
        fieldChanges: [
          {
            entityType: 'voter',
            entityId: household.voters[0]!.id,
            fieldKey: 'occupation',
            value: 'Weaver',
            baseVersion: null,
          },
        ],
      });
      const key = randomUUID();
      const first = await post(a, payload, key).expect(201);
      const again = await post(a, payload, key).expect(201);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);

      expect(await t.prisma.visit.count({ where: { clientId: payload.clientId } })).toBe(1);
      expect(
        await t.prisma.fieldValue.count({
          where: { entityId: household.voters[0]!.id, fieldDefinition: { key: 'occupation' } },
        }),
      ).toBe(1);
      expect(
        await t.prisma.auditEvent.count({
          where: { action: 'visit.create', resourceId: (first.body as VisitCreated).id },
        }),
      ).toBe(1);
    });

    it('the same clientId under a new key is recognised, not stored again', async () => {
      const household = await freshHousehold();
      const payload = body(household.id);
      const first = (await post(a, payload).expect(201)).body as VisitCreated;
      const again = (await post(a, payload).expect(201)).body as VisitCreated;
      expect(again).toMatchObject({ id: first.id, duplicate: true });
      expect(await t.prisma.visit.count({ where: { householdId: household.id } })).toBe(1);

      // Another volunteer can't claim (or learn about) that clientId.
      const b = await loginAs(t, VOLUNTEER_B);
      const other = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station2 },
      });
      await post(b, { ...payload, householdId: other.id }).expect(409);
    });
  });

  it('saves consents and field changes in the same transaction, with a result for each', async () => {
    const household = await freshHousehold();
    const [elder, second] = household.voters;
    const res = await post(
      a,
      body(household.id, {
        consents: [
          {
            ref: 'c1',
            voterId: elder!.id,
            purpose: 'caste_community',
            noticeVersion: '2026.1',
            method: 'in_person_verbal',
          },
        ],
        fieldChanges: [
          {
            entityType: 'voter',
            entityId: elder!.id,
            fieldKey: 'caste_community',
            value: 'Test Community',
            baseVersion: null,
            consentRef: 'c1',
          },
          {
            entityType: 'voter',
            entityId: second!.id,
            fieldKey: 'mobile_number',
            value: '+919000000041',
            baseVersion: null,
          },
          {
            entityType: 'voter',
            entityId: second!.id,
            fieldKey: 'caste_community',
            value: 'No consent',
            baseVersion: null,
          },
          {
            entityType: 'voter',
            entityId: second!.id,
            fieldKey: 'religion',
            value: 'x',
            baseVersion: null,
          },
        ],
      }),
    ).expect(201);
    const visit = res.body as VisitCreated;
    expect(visit.consents).toEqual([{ ref: 'c1', id: expect.any(String) }]);
    expect(
      visit.fieldChanges.map((r) => [r.status, r.status === 'rejected' ? r.code : '']),
    ).toEqual([
      ['applied', ''],
      ['applied', ''],
      ['rejected', 'CONSENT_REQUIRED'],
      ['rejected', 'FIELD_DISABLED'],
    ]);

    const consent = await t.prisma.consent.findUniqueOrThrow({
      where: { id: visit.consents[0]!.id },
    });
    expect(consent).toMatchObject({
      subjectVoterId: elder!.id,
      purpose: 'caste_community',
      status: 'granted',
      capturedById: a.userId,
    });
    const caste = await t.prisma.fieldValue.findFirstOrThrow({
      where: { entityId: elder!.id, fieldDefinition: { key: 'caste_community' } },
    });
    expect(caste).toMatchObject({
      consentId: consent.id,
      collectedAt: new Date('2026-09-20T10:00:00.000Z'),
    });
  });

  it('a stale field change is a conflict, and the visit is still stored', async () => {
    const household = await freshHousehold();
    const voter = household.voters[0]!;
    const change = (value: string) => ({
      fieldChanges: [
        {
          entityType: 'voter',
          entityId: voter.id,
          fieldKey: 'occupation',
          value,
          baseVersion: null,
        },
      ],
    });
    const first = (await post(a, body(household.id, change('Potter'))).expect(201))
      .body as VisitCreated;
    const second = (await post(a, body(household.id, change('Carpenter'))).expect(201))
      .body as VisitCreated;
    expect(first.fieldChanges[0]?.status).toBe('applied');
    expect(second.fieldChanges[0]).toMatchObject({ status: 'conflict' });
    expect(await t.prisma.visit.count({ where: { householdId: household.id } })).toBe(2);
  });

  it('field changes may only touch this household and its members', async () => {
    const household = await freshHousehold();
    const neighbour = await freshHousehold();
    const res = await post(
      a,
      body(household.id, {
        fieldChanges: [
          {
            entityType: 'voter',
            entityId: neighbour.voters[0]!.id,
            fieldKey: 'name',
            value: 'Wrong House',
            baseVersion: null,
          },
        ],
      }),
    ).expect(201);
    expect((res.body as VisitCreated).fieldChanges[0]).toMatchObject({
      status: 'rejected',
      code: 'NOT_FOUND',
    });
    expect(await t.prisma.fieldValue.count({ where: { entityId: neighbour.voters[0]!.id } })).toBe(
      0,
    );
  });

  it('when anything fails, nothing of the visit is stored', async () => {
    const household = await freshHousehold();
    // The audit event is the last write; make the database refuse it.
    const payload = body(household.id, {
      consents: [
        {
          ref: 'c1',
          purpose: 'household_location',
          noticeVersion: '2026.1',
          method: 'in_person_verbal',
        },
      ],
      fieldChanges: [
        {
          entityType: 'voter',
          entityId: household.voters[0]!.id,
          fieldKey: 'name',
          value: 'Kept?',
          baseVersion: null,
        },
      ],
    });
    await t.prisma
      .$executeRaw`ALTER TABLE audit_event ADD CONSTRAINT test_no_visit_audit CHECK (action <> 'visit.create') NOT VALID`;
    try {
      await post(a, payload).expect(500);
    } finally {
      await t.prisma.$executeRaw`ALTER TABLE audit_event DROP CONSTRAINT test_no_visit_audit`;
    }
    expect(await t.prisma.visit.count({ where: { clientId: payload.clientId } })).toBe(0);
    expect(await t.prisma.consent.count({ where: { subjectHouseholdId: household.id } })).toBe(0);
    expect(await t.prisma.fieldValue.count({ where: { entityId: household.voters[0]!.id } })).toBe(
      0,
    );
  });

  describe('404 and validation', () => {
    it('a household outside the scope gets 404, and nothing is stored', async () => {
      const outside = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station2 },
      });
      const payload = body(outside.id);
      const res = await post(a, payload).expect(404);
      expect((res.body as ApiErrorBody).code).toBe('NOT_FOUND');
      expect(await t.prisma.visit.count({ where: { clientId: payload.clientId } })).toBe(0);
    });

    it('rejects impossible visits with 422', async () => {
      const household = await freshHousehold();
      const neighbour = await freshHousehold();
      for (const extra of [
        { startedAt: '2099-01-01T00:00:00.000Z', completedAt: undefined },
        { completedAt: '2026-09-20T09:00:00.000Z' },
        { memberIdsMet: [neighbour.voters[0]!.id] },
        {
          consents: [
            {
              ref: 'x',
              voterId: neighbour.voters[0]!.id,
              purpose: 'caste_community',
              noticeVersion: '1',
              method: 'in_person_verbal',
            },
          ],
        },
        {
          fieldChanges: [
            {
              entityType: 'voter',
              entityId: household.voters[0]!.id,
              fieldKey: 'name',
              value: 'x',
              baseVersion: null,
              consentRef: 'nope',
            },
          ],
        },
      ]) {
        const res = await post(a, body(household.id, extra)).expect(422);
        expect((res.body as ApiErrorBody).code).toBe('UNPROCESSABLE');
      }
      expect(await t.prisma.visit.count({ where: { householdId: household.id } })).toBe(0);
    });

    it('rejects malformed requests with 400', async () => {
      const household = await freshHousehold();
      for (const extra of [
        { outcome: 'done' },
        { clientId: 'abc' },
        { startedAt: 'yesterday' },
        { unknownField: 1 },
        {
          consents: [
            { ref: 'c1', purpose: 'caste_community', noticeVersion: '1', method: 'self_service' },
          ],
        },
        {
          fieldChanges: [
            {
              entityType: 'voter',
              entityId: household.voters[0]!.id,
              fieldKey: 'name',
              baseVersion: null,
            },
          ],
        },
      ]) {
        await post(a, body(household.id, extra)).expect(400);
      }
    });
  });
});
