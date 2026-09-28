import { randomUUID } from 'node:crypto';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { HouseholdDetail } from '../src/households/households.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// Seed (synthetic), in this file's own database: household part1:1 is at
// station 1 (volunteer A), has three roll members plus one volunteer-added
// member, and a location captured with consent. Volunteer B works at station 2.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';

describe('GET /v1/households/:id (real Postgres)', () => {
  let t: TestApp;
  let station1: string;
  let station2: string;

  const station = async (code: string) =>
    (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
      .id;
  /** The seed household that also has the volunteer-added member. */
  const withAddedMember = async () =>
    (await t.prisma.voter.findFirstOrThrow({ where: { origin: 'volunteer_added' } })).householdId;
  const volunteerId = async (phone: string) =>
    (await t.prisma.appUser.findUniqueOrThrow({ where: { phone } })).id;

  beforeAll(async () => {
    t = await createTestApp();
    station1 = await station('1');
    station2 = await station('2');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a signed-in user', async () => {
    await t.http().get(`/v1/households/${randomUUID()}`).expect(401);
  });

  it('returns the household, its members in roll order, and no visit yet', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const id = await withAddedMember();
    const detail = (await http.get(`/v1/households/${id}`).expect(200)).body as HouseholdDetail;

    expect(detail).toMatchObject({ id, pollingStationId: station1, status: 'active' });
    expect(detail.structuredAddress).toMatchObject({ area: 'Demo Nagar' });
    expect(detail.location).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(detail.lastVisit).toBeNull();

    const voters = await t.prisma.voter.findMany({
      where: { householdId: id, recordStatus: 'active' },
    });
    expect(detail.members).toHaveLength(voters.length);
    const official = detail.members.filter((m) => m.origin === 'official_import');
    expect(official.map((m) => m.serialNo)).toEqual(
      [...official.map((m) => m.serialNo)].sort((a, b) => (a ?? 0) - (b ?? 0)),
    );
    expect(detail.members.at(-1)?.origin).toBe('volunteer_added');

    // Roll members carry the printed details; the added member the entered ones.
    const first = voters.find((v) => v.id === official[0]?.id);
    const printed = first?.sourceData as { name: string; age: number; relativeName: string };
    expect(official[0]).toMatchObject({
      epicNumber: first?.sourceVoterId,
      name: printed.name,
      age: printed.age,
      relativeName: printed.relativeName,
      hasConflict: false,
    });
    expect(detail.members.at(-1)).toMatchObject({
      epicNumber: null,
      name: expect.stringMatching(/Demoreddy$/),
      age: 19,
      gender: 'female',
    });
  });

  it('shows a volunteer’s current value over the roll’s, and flags conflicts', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station1 },
      orderBy: { id: 'desc' },
      include: { voters: { where: { origin: 'official_import' }, orderBy: { serialNo: 'asc' } } },
    });
    const [voter] = household.voters;
    const nameField = await t.prisma.fieldDefinition.findFirstOrThrow({ where: { key: 'name' } });
    const collectedById = await volunteerId(VOLUNTEER_A);
    const first = await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: voter!.id,
        fieldDefinitionId: nameField.id,
        value: 'Corrected Name',
        sourceType: 'volunteer_collected',
        collectedById,
        collectedAt: new Date('2026-03-01T00:00:00Z'),
      },
    });

    let detail = (await http.get(`/v1/households/${household.id}`).expect(200))
      .body as HouseholdDetail;
    expect(detail.members[0]).toMatchObject({
      id: voter!.id,
      name: 'Corrected Name',
      hasConflict: false,
    });

    // A second offline edit of the same field collides with the first.
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: voter!.id,
        fieldDefinitionId: nameField.id,
        value: 'Other Name',
        sourceType: 'volunteer_collected',
        collectedById,
        collectedAt: new Date('2026-03-02T00:00:00Z'),
        conflictWithId: first.id,
      },
    });
    detail = (await http.get(`/v1/households/${household.id}`).expect(200)).body as HouseholdDetail;
    expect(detail.members[0]).toMatchObject({ name: 'Other Name', hasConflict: true });
  });

  it('never includes restricted or other fields in the member summary', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const id = await withAddedMember();
    const detail = (await http.get(`/v1/households/${id}`).expect(200)).body as HouseholdDetail;
    for (const member of detail.members) {
      expect(Object.keys(member).sort()).toEqual(
        [
          'age',
          'epicNumber',
          'gender',
          'hasConflict',
          'id',
          'name',
          'origin',
          'relationType',
          'relativeName',
          'sectionNo',
          'serialNo',
        ].sort(),
      );
    }
  });

  it('returns the latest effective visit, with the members met', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station1 },
      orderBy: { id: 'asc' },
      include: { voters: { orderBy: { serialNo: 'asc' } } },
    });
    const volunteer = await volunteerId(VOLUNTEER_A);
    const visit = (outcome: 'completed' | 'follow_up_requested', day: number, corrects?: string) =>
      t.prisma.visit.create({
        data: {
          householdId: household.id,
          volunteerId: volunteer,
          startedAt: new Date(Date.UTC(2026, 8, day)),
          outcome,
          formVersion: 'test',
          clientId: randomUUID(),
          correctsVisitId: corrects,
        },
      });

    await visit('completed', 1);
    const latest = await visit('follow_up_requested', 2);
    const correction = await visit('completed', 2, latest.id);
    await t.prisma.visitMember.create({
      data: { visitId: correction.id, voterId: household.voters[0]!.id },
    });

    const detail = (await http.get(`/v1/households/${household.id}`).expect(200))
      .body as HouseholdDetail;
    expect(detail.lastVisit).toMatchObject({
      id: correction.id,
      outcome: 'completed',
      volunteerId: volunteer,
      memberIdsMet: [household.voters[0]!.id],
    });
  });

  it('volunteer A gets 404 for a booth B household, exactly like a missing one', async () => {
    const booth2 = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station2 },
    });
    const b = await loginAs(t, VOLUNTEER_B);
    await b.http.get(`/v1/households/${booth2.id}`).expect(200);

    const a = await loginAs(t, VOLUNTEER_A);
    const outside = await a.http.get(`/v1/households/${booth2.id}`).expect(404);
    const missing = await a.http.get(`/v1/households/${randomUUID()}`).expect(404);
    const body = (res: typeof outside) => {
      const { requestId: _ignored, ...rest } = res.body as ApiErrorBody;
      return rest;
    };
    expect(body(outside)).toEqual(body(missing));
    expect(body(outside)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the admin sees households of every booth in the AC', async () => {
    const booth2 = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station2 },
    });
    const { http } = await loginAs(t, ADMIN);
    await http.get(`/v1/households/${booth2.id}`).expect(200);
  });

  it('rejects an ID that is not a UUID with 400', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    await http.get('/v1/households/123').expect(400);
  });
});
