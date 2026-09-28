import { randomUUID } from 'node:crypto';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type {
  HouseholdCreated,
  HouseholdUpdated,
  MemberCreated,
} from '../src/households/household-writes.service';
import type { HouseholdDetail } from '../src/households/households.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic), in this file's own database: volunteer A works at station
// 1, volunteer B at station 2. Household fields: address and
// household_location (consent-gated).
const VOLUNTEER_A = '+919999900002';

const ADDRESS = {
  house_no: '12/4',
  street: 'Gandhi Road',
  area: 'Nehru Nagar',
  pin_code: '500038',
  landmark: 'Near water tank',
};
const location = (lat = 17.4, capturedAt = '2026-09-26T12:12:00.000Z') => ({
  lat,
  lng: 78.5,
  accuracyM: 8,
  capturedAt,
  consent: { noticeVersion: '2026.1', method: 'in_person_verbal' },
});

describe('household and member writes (real Postgres)', () => {
  let t: TestApp;
  let a: SignedIn;
  let station1: string;
  let station2: string;

  const station = async (code: string) =>
    (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
      .id;
  const send = (
    method: 'post' | 'patch',
    url: string,
    body: object,
    key: string = randomUUID(),
    who: SignedIn = a,
  ) => who.http[method](url).set('Idempotency-Key', key).send(body);
  let houses = 0;
  /** A new household at station 1, with its own house number. */
  const newHousehold = async (extra: object = {}) =>
    (
      await send('post', '/v1/households', {
        pollingStationId: station1,
        address: { ...ADDRESS, house_no: `T-${(houses += 1)}` },
        ...extra,
      }).expect(201)
    ).body as HouseholdCreated;
  const valuesOf = (entityId: string, key: string) =>
    t.prisma.fieldValue.findMany({
      where: { entityId, fieldDefinition: { key } },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    t = await createTestApp();
    station1 = await station('1');
    station2 = await station('2');
    a = await loginAs(t, VOLUNTEER_A);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('POST /v1/households', () => {
    it('adds a household with a structured address and a location, audited', async () => {
      const created = (
        await send('post', '/v1/households', {
          pollingStationId: station1,
          address: ADDRESS,
          location: location(),
        }).expect(201)
      ).body as HouseholdCreated;
      expect(created).toMatchObject({
        pollingStationId: station1,
        origin: 'volunteer_added',
        status: 'active',
        displayAddress: '12/4, Gandhi Road, Nehru Nagar, 500038',
        structuredAddress: ADDRESS,
        location: { lat: 17.4, lng: 78.5, accuracyM: 8 },
        members: [],
        lastVisit: null,
        duplicate: false,
      });

      // Stored as field values, the location with its consent.
      const [address] = await valuesOf(created.id, 'address');
      expect(address).toMatchObject({ value: ADDRESS, isCurrent: true });
      const [loc] = await valuesOf(created.id, 'household_location');
      const consent = await t.prisma.consent.findUniqueOrThrow({ where: { id: loc!.consentId! } });
      expect(consent).toMatchObject({
        subjectHouseholdId: created.id,
        purpose: 'household_location',
      });
      const household = await t.prisma.household.findUniqueOrThrow({ where: { id: created.id } });
      expect(household).toMatchObject({ houseKey: '12/4', locationConsentId: consent.id });

      const events = await t.prisma.auditEvent.findMany({
        where: { action: 'household.create', resourceId: created.id },
      });
      expect(events).toHaveLength(1);

      // It shows in the list and can be found by street.
      const list = await a.http.get('/v1/households?q=gandhi&limit=200').expect(200);
      expect((list.body as { items: { id: string }[] }).items.map((h) => h.id)).toContain(
        created.id,
      );
    });

    it('replaying with the same key, or the same client id, creates no duplicate', async () => {
      const id = randomUUID();
      const key = randomUUID();
      const body = { id, pollingStationId: station1, address: { house_no: 'R-1' } };
      const first = await send('post', '/v1/households', body, key).expect(201);
      const replay = await send('post', '/v1/households', body, key).expect(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);

      const again = (await send('post', '/v1/households', body).expect(201))
        .body as HouseholdCreated;
      expect(again).toMatchObject({ id, duplicate: true });
      expect(await t.prisma.household.count({ where: { id } })).toBe(1);
      expect(await valuesOf(id, 'address')).toHaveLength(1);
    });

    it('a house number already in the part is a conflict; none needs no number', async () => {
      await newHousehold({ address: { house_no: 'DUP-1' } });
      const res = await send('post', '/v1/households', {
        pollingStationId: station1,
        address: { house_no: 'DUP-1', street: 'Elsewhere' },
      }).expect(409);
      expect((res.body as ApiErrorBody).code).toBe('UNIQUE_VIOLATION');

      await newHousehold({ address: { street: 'No Number Lane' } });
      await newHousehold({ address: { street: 'No Number Lane' } });
    });

    it('a booth outside the scope gets 404, and nothing is stored', async () => {
      const before = await t.prisma.household.count();
      const res = await send('post', '/v1/households', {
        pollingStationId: station2,
        address: ADDRESS,
      }).expect(404);
      expect((res.body as ApiErrorBody).code).toBe('NOT_FOUND');
      expect(await t.prisma.household.count()).toBe(before);
    });

    it('rejects an address without a house number or street, or a bad PIN or location', async () => {
      for (const body of [
        { address: { area: 'Only area' } },
        { address: { house_no: '1', pin_code: '5000' } },
        { address: { house_no: '1', floor: '2' } },
        { address: ADDRESS, location: { ...location(), lat: 120 } },
        { address: ADDRESS, location: { lat: 1, lng: 1, capturedAt: '2026-09-26T12:00:00Z' } },
      ]) {
        const res = await send('post', '/v1/households', { pollingStationId: station1, ...body });
        expect([400, 422]).toContain(res.status);
      }
    });
  });

  describe('POST /v1/households/:id/members', () => {
    it('adds a member not on the roll; the roll data is untouched', async () => {
      const household = await newHousehold();
      const res = await send('post', `/v1/households/${household.id}/members`, {
        name: '  Test Member ',
        age: 34,
        gender: 'female',
        fields: [{ fieldKey: 'mobile_number', value: '+919000000112' }],
      }).expect(201);
      const member = res.body as MemberCreated;
      expect(member.fields.map((f) => [f.fieldKey, f.status])).toEqual([
        ['name', 'applied'],
        ['age', 'applied'],
        ['gender', 'applied'],
        ['mobile_number', 'applied'],
      ]);
      const voter = await t.prisma.voter.findUniqueOrThrow({ where: { id: member.id } });
      expect(voter).toMatchObject({
        householdId: household.id,
        origin: 'volunteer_added',
        sourceVoterId: null,
        sourceData: null,
        pollingStationId: station1,
      });

      const detail = (await a.http.get(`/v1/households/${household.id}`).expect(200))
        .body as HouseholdDetail;
      expect(detail.members).toEqual([
        expect.objectContaining({
          id: member.id,
          name: 'Test Member',
          age: 34,
          gender: 'female',
        }),
      ]);
      expect(
        await t.prisma.auditEvent.count({
          where: { action: 'member.create', resourceId: member.id },
        }),
      ).toBe(1);
    });

    it('a field that fails is reported; the member is still added', async () => {
      const household = await newHousehold();
      const member = (
        await send('post', `/v1/households/${household.id}/members`, {
          name: 'Partly Valid',
          gender: 'unknown',
          fields: [{ fieldKey: 'caste_community', value: 'X' }],
        }).expect(201)
      ).body as MemberCreated;
      expect(
        member.fields.map((f) => [f.fieldKey, f.status === 'rejected' ? f.code : f.status]),
      ).toEqual([
        ['name', 'applied'],
        ['gender', 'INVALID_VALUE'],
        ['caste_community', 'CONSENT_REQUIRED'],
      ]);
    });

    it('a new household and a new member with client ids, one after the other', async () => {
      const householdId = randomUUID();
      const memberId = randomUUID();
      await send('post', '/v1/households', {
        id: householdId,
        pollingStationId: station1,
        address: { street: 'Offline Street' },
      }).expect(201);
      await send('post', `/v1/households/${householdId}/members`, {
        id: memberId,
        name: 'Offline Member',
      }).expect(201);
      const again = (
        await send('post', `/v1/households/${householdId}/members`, {
          id: memberId,
          name: 'Offline Member',
        }).expect(201)
      ).body as MemberCreated;
      expect(again).toMatchObject({ id: memberId, duplicate: true });
      expect(await t.prisma.voter.count({ where: { householdId } })).toBe(1);
    });

    it('a household outside the scope gets 404', async () => {
      const outside = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station2 },
      });
      await send('post', `/v1/households/${outside.id}/members`, { name: 'Nope' }).expect(404);
      expect(
        await t.prisma.voter.count({
          where: { householdId: outside.id, origin: 'volunteer_added' },
        }),
      ).toBe(0);
    });
  });

  describe('PATCH /v1/households/:id', () => {
    it('edits the address of a roll household; the display address follows', async () => {
      const household = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station1, origin: 'official_import' },
      });
      const res = (
        await send('patch', `/v1/households/${household.id}`, {
          address: { house_no: '1-3', street: 'New Street', pin_code: '500001' },
          addressBaseVersion: null,
        }).expect(200)
      ).body as HouseholdUpdated;
      expect(res.results.address).toMatchObject({ status: 'applied' });
      expect(res.household).toMatchObject({
        displayAddress: '1-3, New Street, 500001',
        structuredAddress: { house_no: '1-3', street: 'New Street', pin_code: '500001' },
        // The roll's house number stays the grouping key.
        houseKey: household.houseKey,
      });
      expect(
        await t.prisma.auditEvent.count({
          where: { action: 'household.update', resourceId: household.id },
        }),
      ).toBe(1);
    });

    it('a stale edit is a conflict; the household keeps the current address', async () => {
      const household = await newHousehold();
      const [base] = await valuesOf(household.id, 'address');
      const first = (
        await send('patch', `/v1/households/${household.id}`, {
          address: { ...(household.structuredAddress as object), street: 'First Road' },
          addressBaseVersion: base!.id,
        }).expect(200)
      ).body as HouseholdUpdated;
      expect(first.results.address?.status).toBe('applied');

      const stale = (
        await send('patch', `/v1/households/${household.id}`, {
          address: { ...(household.structuredAddress as object), street: 'Second Road' },
          addressBaseVersion: base!.id,
        }).expect(200)
      ).body as HouseholdUpdated;
      expect(stale.results.address).toMatchObject({ status: 'conflict' });
      expect(stale.household.structuredAddress).toMatchObject({ street: 'First Road' });
      expect((await valuesOf(household.id, 'address')).filter((v) => v.isCurrent)).toHaveLength(2);
    });

    it('captures a location with a new consent', async () => {
      const household = await newHousehold();
      const res = (
        await send('patch', `/v1/households/${household.id}`, {
          location: location(17.45, '2026-09-27T08:00:00.000Z'),
          locationBaseVersion: null,
        }).expect(200)
      ).body as HouseholdUpdated;
      expect(res.results.location).toMatchObject({ status: 'applied' });
      expect(res.household.location).toMatchObject({
        lat: 17.45,
        capturedAt: '2026-09-27T08:00:00.000Z',
      });
      const stored = await t.prisma.household.findUniqueOrThrow({ where: { id: household.id } });
      const consent = await t.prisma.consent.findUniqueOrThrow({
        where: { id: stored.locationConsentId! },
      });
      expect(consent).toMatchObject({ subjectHouseholdId: household.id, status: 'granted' });
    });

    it('replaying the same edit creates no duplicate value', async () => {
      const household = await newHousehold();
      const [base] = await valuesOf(household.id, 'address');
      const key = randomUUID();
      const body = { address: { house_no: '9' }, addressBaseVersion: base!.id };
      await send('patch', `/v1/households/${household.id}`, body, key).expect(200);
      await send('patch', `/v1/households/${household.id}`, body, key).expect(200);
      expect(await valuesOf(household.id, 'address')).toHaveLength(2);
    });

    it('a household outside the scope gets 404; a bad request gets 400 or 422', async () => {
      const outside = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station2 },
      });
      await send('patch', `/v1/households/${outside.id}`, {
        address: ADDRESS,
        addressBaseVersion: null,
      }).expect(404);
      expect(await valuesOf(outside.id, 'address')).toEqual([]);

      const mine = await newHousehold();
      await send('patch', `/v1/households/${mine.id}`, {}).expect(422);
      const noBase = await send('patch', `/v1/households/${mine.id}`, { address: ADDRESS });
      expect([400, 422]).toContain(noBase.status);
    });
  });
});
