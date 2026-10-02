import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { TokenService } from '../src/auth/token.service';
import { FieldValuesService } from '../src/field-values/field-values.service';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { seedId } from '../src/database/seed/random';
import type {
  VoterDetailsEdited,
  VoterSelf,
  VoterUpdates,
} from '../src/voter-self/voter-self.service';
import type { VoterDetail } from '../src/voters/voters.service';
import { loginAs } from './support/auth';
import { createTestApp, type TestApp } from './support/app';

// A voter's own record (#224). Synthetic seed data only: voter part1:1 has a
// mobile number and an occupation on record, collected by volunteer A.
const VOTER = seedId('voter:part1:1');
const VOTER_PHONE = '+919999900101';

describe('voter self-service (real Postgres)', () => {
  let t: TestApp;
  let voterUserId: string;
  const body = (res: { body: unknown }) => res.body as ApiErrorBody;

  beforeAll(async () => {
    t = await createTestApp();
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    const user = await t.prisma.appUser.create({
      data: { organizationId: admin.organizationId, name: 'Synthetic Voter', phone: VOTER_PHONE },
    });
    voterUserId = user.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  /** A voter's session, as `voter-auth/otp/verify` makes it (#223). */
  async function asVoter(voterId = VOTER) {
    const { tokens } = await t.app
      .get(TokenService)
      .startSession(voterUserId, 'voter-device', voterId);
    return request
      .agent(t.app.getHttpServer())
      .set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  const edit = (
    agent: Awaited<ReturnType<typeof asVoter>>,
    fields: { fieldKey: string; value: unknown; baseVersion: string | null }[],
  ) => agent.patch('/v1/voter/me/details').set('Idempotency-Key', randomUUID()).send({ fields });

  it('shows the official record, the booth, and the details the voter shares', async () => {
    const voter = await asVoter();
    const me = (await voter.get('/v1/voter/me').expect(200)).body as VoterSelf;
    const row = await t.prisma.voter.findUniqueOrThrow({ where: { id: VOTER } });
    const official = row.sourceData as Record<string, unknown>;

    expect(me.id).toBe(VOTER);
    expect(me.epicNumber).toBe(row.sourceVoterId);
    expect(me.official).toMatchObject({
      name: official.name,
      age: official.age,
      gender: official.gender,
      relativeName: official.relativeName,
    });
    expect(me.serialNo).toBe(row.serialNo);
    expect(me.booth).toEqual({ code: '1', name: 'Demo Primary School, Room 1' });
    expect(me.part).toMatchObject({ code: '1' });
    expect(me.household.address).toMatch(/^H NO /);

    // Mobile, occupation and additional info, in that order; nothing else.
    expect(me.shared.map((s) => s.key)).toEqual(['mobile_number', 'occupation', 'additional_info']);
    expect(me.shared[0]).toMatchObject({ value: VOTER_PHONE, fieldValueId: expect.any(String) });
    expect(me.shared[1]!.value).toEqual(expect.any(String));
    expect(me.shared[2]).toMatchObject({ value: null, fieldValueId: null });

    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'voter.self_view', resourceId: VOTER },
    });
    expect(audit.actorId).toBe(voterUserId);
  });

  it('an edit is current at once, as shared by the voter, and the volunteer sees it', async () => {
    const voter = await asVoter();
    const me = (await voter.get('/v1/voter/me').expect(200)).body as VoterSelf;
    const occupation = me.shared.find((s) => s.key === 'occupation')!;

    const res = await edit(voter, [
      { fieldKey: 'occupation', value: 'Synthetic Tailor', baseVersion: occupation.fieldValueId },
      { fieldKey: 'additional_info', value: 'Prefers calls after 6 pm', baseVersion: null },
    ]).expect(200);
    const { fields } = res.body as VoterDetailsEdited;
    expect(fields.map((f) => [f.fieldKey, f.status])).toEqual([
      ['occupation', 'applied'],
      ['additional_info', 'applied'],
    ]);

    const value = await t.prisma.fieldValue.findFirstOrThrow({
      where: { entityId: VOTER, isCurrent: true, fieldDefinition: { key: 'occupation' } },
    });
    expect(value).toMatchObject({
      value: 'Synthetic Tailor',
      sourceType: 'voter_self_submitted',
      collectedById: voterUserId,
      supersedesId: occupation.fieldValueId,
    });

    // The booth's volunteer sees it, marked as the voter's.
    const volunteer = await loginAs(t, '+919999900002');
    const detail = (await volunteer.http.get(`/v1/voters/${VOTER}`).expect(200))
      .body as VoterDetail;
    const field = detail.fields.find((f) => f.key === 'occupation')!;
    expect(field.current).toEqual([
      expect.objectContaining({ value: 'Synthetic Tailor', sourceType: 'voter_self_submitted' }),
    ]);

    // Audited with keys and outcomes only.
    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'voter.self_update', resourceId: VOTER },
      orderBy: { seq: 'desc' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Synthetic Tailor');
    expect(audit.metadata).toMatchObject({
      fields: [
        { key: 'occupation', status: 'applied' },
        { key: 'additional_info', status: 'applied' },
      ],
    });
  });

  it('official details and restricted fields are refused; a stale edit is a conflict', async () => {
    const voter = await asVoter();
    const me = (await voter.get('/v1/voter/me').expect(200)).body as VoterSelf;
    const mobile = me.shared.find((s) => s.key === 'mobile_number')!;
    // Someone else changes the mobile number after the app showed it.
    const volunteer = await loginAs(t, '+919999900002');
    await volunteer.http
      .patch(`/v1/voters/${VOTER}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        fields: [
          { fieldKey: 'mobile_number', value: '+919999900102', baseVersion: mobile.fieldValueId },
        ],
      })
      .expect(200);

    const res = await edit(voter, [
      { fieldKey: 'name', value: 'Someone Else', baseVersion: null },
      { fieldKey: 'caste_community', value: 'Synthetic', baseVersion: null },
      { fieldKey: 'mobile_number', value: '+919999900103', baseVersion: mobile.fieldValueId },
    ]).expect(200);
    const { fields } = res.body as VoterDetailsEdited;
    expect(fields.map((f) => [f.fieldKey, f.status, 'code' in f ? f.code : null])).toEqual([
      ['name', 'rejected', 'FORBIDDEN'],
      ['caste_community', 'rejected', 'FORBIDDEN'],
      ['mobile_number', 'conflict', null],
    ]);
    // The name is still the roll's.
    expect(
      await t.prisma.fieldValue.count({
        where: { entityId: VOTER, fieldDefinition: { key: 'name' } },
      }),
    ).toBe(0);
  });

  it('updates: changes (who, never the values), household visits, and joining', async () => {
    const volunteer = await loginAs(t, '+919999900002');
    const visit = {
      clientId: randomUUID(),
      householdId: seedId('household:part1:1'),
      startedAt: '2026-09-30T10:00:00.000Z',
      completedAt: '2026-09-30T10:05:00.000Z',
      outcome: 'no_one_available',
      formVersion: '2026.1',
      memberIdsMet: [],
    };
    await volunteer.http
      .post('/v1/visits')
      .set('Idempotency-Key', randomUUID())
      .send(visit)
      .expect(201);

    // A caste value with consent: restricted, never listed.
    const caste = await t.prisma.fieldDefinition.findFirstOrThrow({
      where: { key: 'caste_community' },
    });
    const consent = await t.prisma.consent.create({
      data: {
        subjectVoterId: VOTER,
        purpose: 'caste_community',
        noticeVersion: '2026.1',
        capturedMethod: 'in_person_verbal',
        capturedById: volunteer.userId,
      },
    });
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: VOTER,
        fieldDefinitionId: caste.id,
        value: 'Synthetic community',
        sourceType: 'volunteer_collected',
        collectedById: volunteer.userId,
        consentId: consent.id,
      },
    });

    const voter = await asVoter();
    const { items } = (await voter.get('/v1/voter/me/updates').expect(200)).body as VoterUpdates;
    const text = JSON.stringify(items);
    expect(text).not.toContain('caste');
    expect(text).not.toContain('Synthetic');
    expect(text).not.toContain(VOTER_PHONE);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'detail', fieldKey: 'occupation', by: 'you' }),
        expect.objectContaining({ kind: 'detail', fieldKey: 'mobile_number', by: 'volunteer' }),
        expect.objectContaining({ kind: 'visit', outcome: 'no_one_available' }),
        expect.objectContaining({ kind: 'joined' }),
      ]),
    );
    // Newest first.
    const times = items.map((i) => new Date(i.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('only a voter session can use these; staff and other routes stay closed', async () => {
    const volunteer = await loginAs(t, '+919999900002');
    expect(body(await volunteer.http.get('/v1/voter/me').expect(403)).code).toBe('FORBIDDEN');
    await volunteer.http.get('/v1/voter/me/updates').expect(403);

    const voter = await asVoter();
    // Another voter can't be named: the staff routes refuse the voter.
    await voter
      .patch(`/v1/voters/${seedId('voter:part1:2')}`)
      .set('Idempotency-Key', randomUUID())
      .send({ fields: [{ fieldKey: 'occupation', value: 'x', baseVersion: null }] })
      .expect(403);
    await voter.get(`/v1/voters/${seedId('voter:part1:2')}`).expect(404);
    // Fields can't be sneaked in: unknown properties are refused.
    await voter
      .patch('/v1/voter/me/details')
      .set('Idempotency-Key', randomUUID())
      .send({ voterId: seedId('voter:part1:2'), fields: [] })
      .expect(400);
  });

  it('even inside the API, a voter scope reaches only its own record', async () => {
    const scope = {
      userId: voterUserId,
      roles: ['voter' as const],
      nodeIds: [],
      boothIds: [],
      voterId: VOTER,
    };
    const [other] = await t.app.get(FieldValuesService).write(scope, voterUserId, [
      {
        entityType: 'voter',
        entityId: seedId('voter:part1:2'),
        fieldKey: 'occupation',
        value: 'x',
        baseVersion: null,
      },
    ]);
    expect(other).toMatchObject({ status: 'rejected', code: 'NOT_FOUND' });
    const [household] = await t.app.get(FieldValuesService).write(scope, voterUserId, [
      {
        entityType: 'household',
        entityId: seedId('household:part1:1'),
        fieldKey: 'address',
        value: { house_no: '1' },
        baseVersion: null,
      },
    ]);
    expect(household).toMatchObject({ status: 'rejected', code: 'NOT_FOUND' });
  });

  it('updates show a corrected visit as corrected', async () => {
    const volunteer = await loginAs(t, '+919999900002');
    const first = await volunteer.http
      .post('/v1/visits')
      .set('Idempotency-Key', randomUUID())
      .send({
        clientId: randomUUID(),
        householdId: seedId('household:part1:1'),
        startedAt: '2026-09-20T10:00:00.000Z',
        completedAt: '2026-09-20T10:05:00.000Z',
        outcome: 'refused',
        formVersion: '2026.1',
        memberIdsMet: [],
      })
      .expect(201);
    await volunteer.http
      .post('/v1/visits')
      .set('Idempotency-Key', randomUUID())
      .send({
        clientId: randomUUID(),
        householdId: seedId('household:part1:1'),
        startedAt: '2026-09-20T10:00:00.000Z',
        completedAt: '2026-09-20T10:05:00.000Z',
        outcome: 'unsafe_or_inaccessible',
        formVersion: '2026.1',
        memberIdsMet: [],
        correctsVisitId: (first.body as { id: string }).id,
      })
      .expect(201);
    const { items } = (await (await asVoter()).get('/v1/voter/me/updates').expect(200))
      .body as VoterUpdates;
    const outcomes = items
      .filter((i) => i.kind === 'visit')
      .map((i) => 'outcome' in i && i.outcome);
    expect(outcomes).toContain('unsafe_or_inaccessible');
    expect(outcomes).not.toContain('refused');
  });

  it('an admin correction is shown as one; the current value wins over a later-collected old one', async () => {
    const voter4 = seedId('voter:part1:4');
    const occupation = await t.prisma.fieldDefinition.findFirstOrThrow({
      where: { key: 'occupation' },
    });
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    // Collected on 5 Oct, then replaced by an edit made offline on 1 Sep.
    const older = await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: voter4,
        fieldDefinitionId: occupation.id,
        value: 'Synthetic Old',
        sourceType: 'volunteer_collected',
        collectedById: admin.id,
        collectedAt: new Date('2026-10-05T00:00:00Z'),
      },
    });
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: voter4,
        fieldDefinitionId: occupation.id,
        value: 'Synthetic Current',
        sourceType: 'admin_corrected',
        collectedById: admin.id,
        collectedAt: new Date('2026-09-01T00:00:00Z'),
        supersedesId: older.id,
      },
    });
    const voter = await asVoter(voter4);
    const me = (await voter.get('/v1/voter/me').expect(200)).body as VoterSelf;
    expect(me.shared.find((x) => x.key === 'occupation')!.value).toBe('Synthetic Current');
    const { items } = (await voter.get('/v1/voter/me/updates').expect(200)).body as VoterUpdates;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'detail', fieldKey: 'occupation', by: 'admin' }),
      ]),
    );
  });

  it('a record no longer on the roll is 404', async () => {
    await t.prisma.voter.update({ where: { id: VOTER }, data: { recordStatus: 'deleted' } });
    try {
      const voter = await asVoter();
      await voter.get('/v1/voter/me').expect(404);
      await edit(voter, [{ fieldKey: 'occupation', value: 'x', baseVersion: null }]).expect(404);
    } finally {
      await t.prisma.voter.update({ where: { id: VOTER }, data: { recordStatus: 'active' } });
    }
  });

  it('a newer roll replaced the record: the voter sees the new one', async () => {
    const old = await t.prisma.voter.findUniqueOrThrow({ where: { id: seedId('voter:part1:3') } });
    const version = await t.prisma.sourceVersion.findUniqueOrThrow({
      where: { id: old.sourceVersionId! },
    });
    const newer = await t.prisma.sourceVersion.create({
      data: {
        programId: version.programId,
        partNodeId: version.partNodeId,
        revisionYear: version.revisionYear + 1,
        revisionType: 'Synthetic revision',
        rollIdentification: 'Synthetic roll, revision 2',
        checksum: 'f'.repeat(64),
        previousVersionId: version.id,
      },
    });
    await t.prisma.voter.update({ where: { id: old.id }, data: { recordStatus: 'superseded' } });
    const replacement = await t.prisma.voter.create({
      data: {
        programId: old.programId,
        householdId: old.householdId,
        partId: old.partId,
        pollingStationId: old.pollingStationId,
        sourceVoterId: old.sourceVoterId,
        sourceVersionId: newer.id,
        importFileId: old.importFileId,
        sourceData: old.sourceData ?? {},
        sectionNo: old.sectionNo,
        serialNo: old.serialNo,
        previousVoterId: old.id,
      },
    });
    // A detail collected on the old record, then carried over to the new
    // one: the copy is not a change.
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: old.id,
        fieldDefinitionId: (
          await t.prisma.fieldDefinition.findFirstOrThrow({ where: { key: 'mobile_number' } })
        ).id,
        value: '+919999900133',
        sourceType: 'volunteer_collected',
        collectedById: admin.id,
      },
    });
    const carried = await t.prisma.fieldValue.findMany({
      where: { entityId: old.id, isCurrent: true },
    });
    for (const value of carried) {
      await t.prisma.fieldValue.create({
        data: {
          entityType: 'voter',
          entityId: replacement.id,
          fieldDefinitionId: value.fieldDefinitionId,
          value: value.value ?? {},
          sourceType: value.sourceType,
          collectedById: value.collectedById,
          collectedAt: value.collectedAt,
          carriedFromId: value.id,
        },
      });
    }
    const voter = await asVoter(old.id);
    const me = (await voter.get('/v1/voter/me').expect(200)).body as VoterSelf;
    expect(me.id).toBe(replacement.id);
    const before = (
      (await voter.get('/v1/voter/me/updates').expect(200)).body as VoterUpdates
    ).items.filter((i) => i.kind === 'detail');
    expect(carried).toHaveLength(1);
    expect(before).toHaveLength(1);
    const res = await edit(voter, [
      { fieldKey: 'occupation', value: 'Synthetic Weaver', baseVersion: null },
    ]).expect(200);
    expect((res.body as VoterDetailsEdited).fields[0]!.status).toBe('applied');
    const written = await t.prisma.fieldValue.findFirstOrThrow({
      where: { fieldDefinition: { key: 'occupation' }, isCurrent: true, entityId: replacement.id },
    });
    expect(written.value).toBe('Synthetic Weaver');
  });
});
