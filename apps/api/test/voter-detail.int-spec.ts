import { randomUUID } from 'node:crypto';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { VoterDetail, VoterField } from '../src/voters/voters.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// Seed (synthetic), in this file's own database: voter part1:1 (station 1,
// volunteer A) has an occupation and a mobile number entered by volunteer A.
// Caste/community is enabled behind consent; religion and political
// affiliation are disabled. Volunteer B works at station 2.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';
const MANAGER = '+919999900039';

describe('GET /v1/voters/:id (real Postgres)', () => {
  let t: TestApp;
  let station1: string;
  let station2: string;
  let volunteerA: string;

  const station = async (code: string) =>
    (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
      .id;
  const definition = (key: string) => t.prisma.fieldDefinition.findFirstOrThrow({ where: { key } });
  const field = (detail: VoterDetail, key: string): VoterField | undefined =>
    detail.fields.find((f) => f.key === key);
  /** A roll voter at station 1 with no entered values yet (a fresh one per test). */
  let spare = 0;
  const freshVoter = async () => {
    const voters = await t.prisma.voter.findMany({
      where: { pollingStationId: station1, origin: 'official_import' },
      orderBy: { serialNo: 'desc' },
    });
    spare += 1;
    return voters[spare - 1]!;
  };
  const write = async (
    voterId: string,
    key: string,
    value: unknown,
    extra: { supersedesId?: string; consentId?: string; day?: number } = {},
  ) =>
    t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: voterId,
        fieldDefinitionId: (await definition(key)).id,
        value: value as object,
        sourceType: 'volunteer_collected',
        collectedById: volunteerA,
        collectedAt: new Date(Date.UTC(2026, 8, extra.day ?? 1)),
        supersedesId: extra.supersedesId,
        consentId: extra.consentId,
      },
    });
  const consent = (voterId: string, purpose = 'caste_community') =>
    t.prisma.consent.create({
      data: {
        subjectVoterId: voterId,
        purpose,
        noticeVersion: 'test',
        capturedMethod: 'in_person_verbal',
        capturedById: volunteerA,
      },
    });
  const get = async (phone: string, id: string, query = '') =>
    (await (await loginAs(t, phone)).http.get(`/v1/voters/${id}${query}`).expect(200))
      .body as VoterDetail;

  beforeAll(async () => {
    t = await createTestApp();
    station1 = await station('1');
    station2 = await station('2');
    volunteerA = (await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } })).id;

    // A campaign manager on the AC: sees booth data, but not restricted fields.
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

  it('needs a signed-in user', async () => {
    await t.http().get(`/v1/voters/${randomUUID()}`).expect(401);
  });

  it('returns the official values and the current value of each field', async () => {
    const voter = await t.prisma.voter.findFirstOrThrow({
      where: { pollingStationId: station1, serialNo: 1 },
      orderBy: { id: 'asc' },
    });
    const detail = await get(VOLUNTEER_A, voter.id);

    expect(detail).toMatchObject({
      id: voter.id,
      householdId: voter.householdId,
      pollingStationId: station1,
      origin: 'official_import',
      epicNumber: voter.sourceVoterId,
      official: voter.sourceData,
    });
    // Every enabled field is listed, set or not.
    expect(field(detail, 'name')?.current).toEqual([]);
    const occupation = field(detail, 'occupation');
    expect(occupation?.current).toHaveLength(1);
    expect(occupation?.current[0]).toMatchObject({
      sourceType: 'volunteer_collected',
      collectedBy: { id: volunteerA },
      supersedesId: null,
      conflictWithId: null,
    });
    const stored = await t.prisma.fieldValue.findFirstOrThrow({
      where: { entityId: voter.id, fieldDefinition: { key: 'occupation' }, isCurrent: true },
    });
    expect(occupation?.current[0]?.id).toBe(stored.id); // the base_version for an edit
    expect(occupation).not.toHaveProperty('history');
  });

  it('never returns a disabled field, even one that has a value', async () => {
    const voter = await freshVoter();
    const religion = await definition('religion');
    await t.prisma.fieldDefinition.update({
      where: { id: religion.id },
      data: { enabled: true, requiresConsent: true, legalBasis: 'test only' },
    });
    const agreed = await consent(voter.id, 'religion');
    await write(voter.id, 'religion', 'test value', { consentId: agreed.id });
    await t.prisma.fieldDefinition.update({
      where: { id: religion.id },
      data: { enabled: false },
    });

    const detail = await get(ADMIN, voter.id, '?history=true');
    const keys = detail.fields.map((f) => f.key);
    expect(keys).not.toContain('religion');
    expect(keys).not.toContain('political_affiliation');
    expect(JSON.stringify(detail)).not.toContain('test value');
  });

  describe('caste/community', () => {
    it('is shown to volunteers and admins, and hidden from other roles', async () => {
      const voter = await freshVoter();
      const agreed = await consent(voter.id);
      await write(voter.id, 'caste_community', 'Test Community', { consentId: agreed.id });

      for (const phone of [VOLUNTEER_A, ADMIN]) {
        const detail = await get(phone, voter.id);
        expect(field(detail, 'caste_community')?.current[0]?.value).toBe('Test Community');
      }
      const manager = await get(MANAGER, voter.id, '?history=true');
      expect(field(manager, 'caste_community')).toBeUndefined();
      expect(manager.fields.every((f) => !f.isRestricted)).toBe(true);
      expect(JSON.stringify(manager)).not.toContain('Test Community');
    });

    it('is hidden once the voter withdraws consent', async () => {
      const voter = await freshVoter();
      const agreed = await consent(voter.id);
      await write(voter.id, 'caste_community', 'Withdrawn Community', { consentId: agreed.id });
      await t.prisma.consent.update({
        where: { id: agreed.id },
        data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawnById: volunteerA },
      });

      const detail = await get(VOLUNTEER_A, voter.id, '?history=true');
      expect(field(detail, 'caste_community')).toMatchObject({ current: [], history: [] });
      expect(JSON.stringify(detail)).not.toContain('Withdrawn Community');
    });
  });

  it('?history=true returns the chain of values after two edits', async () => {
    const voter = await freshVoter();
    const first = await write(voter.id, 'occupation', 'Farmer', { day: 1 });
    const second = await write(voter.id, 'occupation', 'Teacher', {
      supersedesId: first.id,
      day: 2,
    });
    const third = await write(voter.id, 'occupation', 'Trader', {
      supersedesId: second.id,
      day: 3,
    });

    const plain = await get(VOLUNTEER_A, voter.id);
    expect(field(plain, 'occupation')?.current.map((v) => v.value)).toEqual(['Trader']);

    const detail = await get(VOLUNTEER_A, voter.id, '?history=true');
    const occupation = field(detail, 'occupation');
    expect(occupation?.current).toEqual([
      expect.objectContaining({ id: third.id, value: 'Trader', supersedesId: second.id }),
    ]);
    expect(occupation?.history).toEqual([
      expect.objectContaining({ id: second.id, value: 'Teacher', supersedesId: first.id }),
      expect.objectContaining({ id: first.id, value: 'Farmer', supersedesId: null }),
    ]);
    expect(field(detail, 'name')?.history).toEqual([]);
  });

  it('volunteer A gets 404 for a booth B voter, exactly like a missing one', async () => {
    const other = await t.prisma.voter.findFirstOrThrow({ where: { pollingStationId: station2 } });
    await get(VOLUNTEER_B, other.id);

    const { http } = await loginAs(t, VOLUNTEER_A);
    const outside = await http.get(`/v1/voters/${other.id}`).expect(404);
    const missing = await http.get(`/v1/voters/${randomUUID()}`).expect(404);
    const body = (res: typeof outside) => {
      const { requestId: _ignored, ...rest } = res.body as ApiErrorBody;
      return rest;
    };
    expect(body(outside)).toEqual(body(missing));
    expect(body(outside)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('audits every opening of a record, with ids only; a voter outside the area isn’t', async () => {
    const voter = await freshVoter();
    const { http, userId } = await loginAs(t, ADMIN);
    const views = () =>
      t.prisma.auditEvent.findMany({
        where: { action: 'voter.view', resourceId: voter.id },
        orderBy: { seq: 'asc' },
      });
    const before = (await views()).length;
    await http.get(`/v1/voters/${voter.id}?history=true`).expect(200);
    const events = await views();
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toMatchObject({
      actorId: userId,
      resourceType: 'voter',
      result: 'success',
      metadata: { history: true },
    });
    // No names, EPICs or values.
    const text = JSON.stringify(events.at(-1)!.metadata);
    expect(text).not.toContain(voter.sourceVoterId ?? 'n/a');
    expect(text).not.toMatch(/name/i);

    // Not found (or outside the area): nothing to audit as viewed.
    const other = await t.prisma.voter.findFirstOrThrow({ where: { pollingStationId: station2 } });
    const volunteerA = await loginAs(t, VOLUNTEER_A);
    await volunteerA.http.get(`/v1/voters/${other.id}`).expect(404);
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'voter.view', resourceId: other.id, actorId: volunteerA.userId },
      }),
    ).toBe(0);
  });

  it('rejects a bad ID or history flag with 400', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const voter = await freshVoter();
    await http.get('/v1/voters/123').expect(400);
    await http.get(`/v1/voters/${voter.id}?history=yes`).expect(400);
    await http.get(`/v1/voters/${voter.id}?history=false`).expect(200);
  });
});
