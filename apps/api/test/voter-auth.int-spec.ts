import type { Redis } from 'ioredis';
import request from 'supertest';

import type { TokenPair } from '../src/auth/dto';
import { OTP_SENDER, type OtpSender } from '../src/auth/otp-sender';
import { epicRateKey, otpRateKey, voterOtpKey } from '../src/auth/otp.service';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { seedId } from '../src/database/seed/random';
import { REDIS } from '../src/redis/redis.module';
import { loginAs } from './support/auth';
import { createTestApp, type TestApp } from './support/app';

// Voter sign-in (#223). Synthetic seed data only: voter part1:1 has the mobile
// number +919999900101 on record (collected by a volunteer). Redis is shared
// between test files, so only this file uses these phones and EPICs.
const VOTER_PHONE = '+919999900101';
const OTHER_PHONE = '+919999900199';
const STAFF_PHONE = '+919999900002'; // Demo Volunteer A

describe('voter sign-in (real Postgres and Redis)', () => {
  let t: TestApp;
  let redis: Redis;
  let epic: string;
  let otherEpic: string;
  const sent = new Map<string, string>();
  const send = jest.fn((phone: string, code: string) => {
    sent.set(phone, code);
    return Promise.resolve();
  });
  const sender: OtpSender = { send };
  const body = (res: { body: unknown }) => res.body as ApiErrorBody;

  const keys = () => [
    ...[VOTER_PHONE, OTHER_PHONE, STAFF_PHONE].map(otpRateKey),
    ...[epic, otherEpic, 'NOSUCH0001'].map(epicRateKey),
    voterOtpKey(epic, VOTER_PHONE),
    voterOtpKey(otherEpic, VOTER_PHONE),
  ];

  beforeAll(async () => {
    t = await createTestApp((builder) => builder.overrideProvider(OTP_SENDER).useValue(sender));
    redis = t.app.get<Redis>(REDIS);
    const voter = await t.prisma.voter.findUniqueOrThrow({
      where: { id: seedId('voter:part1:1') },
    });
    const other = await t.prisma.voter.findUniqueOrThrow({
      where: { id: seedId('voter:part1:2') },
    });
    epic = voter.sourceVoterId!;
    otherEpic = other.sourceVoterId!;
    await redis.del(...keys());
  });

  afterAll(async () => {
    await redis?.del(...keys());
    await t?.close();
  });

  beforeEach(async () => {
    send.mockClear();
    sent.clear();
    await redis.del(...keys());
  });

  const requestCode = (e: string, phone: string) =>
    t.http().post('/v1/voter-auth/otp/request').send({ epic: e, phone });
  const verify = (e: string, phone: string, code: string, deviceId = 'voter-device-1') =>
    t.http().post('/v1/voter-auth/otp/verify').send({ epic: e, phone, code, deviceId });

  async function signIn(): Promise<TokenPair> {
    await requestCode(epic, VOTER_PHONE).expect(202);
    const code = sent.get(VOTER_PHONE)!;
    return (await verify(epic, VOTER_PHONE, code).expect(200)).body as TokenPair;
  }

  const as = (tokens: TokenPair) =>
    request.agent(t.app.getHttpServer()).set('Authorization', `Bearer ${tokens.accessToken}`);

  it('the EPIC and the mobile on record sign the voter in', async () => {
    // Spaces and lower case in the EPIC are fine.
    await requestCode(` ${epic.toLowerCase()} `, VOTER_PHONE).expect(202);
    expect(send).toHaveBeenCalledTimes(1);
    const res = await verify(epic, VOTER_PHONE, sent.get(VOTER_PHONE)!).expect(200);
    const tokens = res.body as TokenPair;
    expect(tokens.tokenType).toBe('Bearer');

    const me = await as(tokens).get('/v1/me').expect(200);
    expect(me.body).toMatchObject({
      phone: VOTER_PHONE,
      assignments: [],
      voter: { id: seedId('voter:part1:1') },
    });

    // The session acts for the voter; its user was made at the first sign-in.
    const session = await t.prisma.session.findFirstOrThrow({
      where: { voterId: seedId('voter:part1:1') },
      include: { user: { include: { roleAssignments: true } } },
    });
    expect(session.user.phone).toBe(VOTER_PHONE);
    expect(session.user.roleAssignments).toEqual([]);

    // Audited without the EPIC or the phone.
    const event = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'auth.login', resourceId: session.id },
    });
    expect(event.result).toBe('success');
    expect(JSON.stringify(event.metadata)).not.toContain(epic);
    expect(JSON.stringify(event.metadata)).not.toContain(VOTER_PHONE);
  });

  it('signing in again uses the same user', async () => {
    await signIn();
    await signIn();
    expect(await t.prisma.appUser.count({ where: { phone: VOTER_PHONE } })).toBe(1);
  });

  it('reveals nothing: an unknown EPIC, or a phone not on record, looks the same', async () => {
    for (const [e, phone] of [
      ['NOSUCH0001', VOTER_PHONE], // no such voter
      [otherEpic, VOTER_PHONE], // a real voter, but not this phone
      [epic, OTHER_PHONE], // this voter, another phone
    ] as const) {
      const res = await requestCode(e, phone).expect(202);
      expect(res.body).toEqual({});
    }
    expect(send).not.toHaveBeenCalled();

    // Verifying any of them: the same answer as a wrong code.
    const wrong = await verify(epic, VOTER_PHONE, '000000').expect(401);
    const unknown = await verify('NOSUCH0001', VOTER_PHONE, '123456').expect(401);
    const notOnRecord = await verify(otherEpic, VOTER_PHONE, '123456').expect(401);
    for (const res of [wrong, unknown, notOnRecord]) {
      expect(body(res).code).toBe('OTP_INVALID');
      expect(body(res).message).toBe(body(wrong).message);
    }
  });

  it('a code is for this EPIC and phone only', async () => {
    await requestCode(epic, VOTER_PHONE).expect(202);
    const code = sent.get(VOTER_PHONE)!;
    // Staff sign-in with the same phone and code: refused.
    await t
      .http()
      .post('/v1/auth/otp/verify')
      .send({ phone: VOTER_PHONE, code, deviceId: 'x' })
      .expect(401);
    // Another voter's EPIC with this code: refused.
    await verify(otherEpic, VOTER_PHONE, code).expect(401);
    // The right pair: accepted, once.
    await verify(epic, VOTER_PHONE, code).expect(200);
    await verify(epic, VOTER_PHONE, code).expect(401);
  });

  it('a mobile number changed after the code was sent: refused', async () => {
    await requestCode(epic, VOTER_PHONE).expect(202);
    const code = sent.get(VOTER_PHONE)!;
    const current = await t.prisma.fieldValue.findFirstOrThrow({
      where: {
        entityId: seedId('voter:part1:1'),
        isCurrent: true,
        fieldDefinition: { key: 'mobile_number' },
      },
    });
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: seedId('voter:part1:1'),
        fieldDefinitionId: current.fieldDefinitionId,
        value: OTHER_PHONE,
        sourceType: 'admin_corrected',
        collectedById: admin.id,
        supersedesId: current.id,
      },
    });
    try {
      expect(body(await verify(epic, VOTER_PHONE, code).expect(401)).code).toBe('OTP_INVALID');
    } finally {
      // Put the original number back for the other tests.
      const changed = await t.prisma.fieldValue.findFirstOrThrow({
        where: { supersedesId: current.id },
      });
      await t.prisma.fieldValue.create({
        data: {
          entityType: 'voter',
          entityId: seedId('voter:part1:1'),
          fieldDefinitionId: current.fieldDefinitionId,
          value: VOTER_PHONE,
          sourceType: 'admin_corrected',
          collectedById: admin.id,
          supersedesId: changed.id,
        },
      });
    }
  });

  it('code requests are limited per phone and per EPIC, matching or not', async () => {
    for (let i = 0; i < 3; i += 1) await requestCode('NOSUCH0001', OTHER_PHONE).expect(202);
    expect(body(await requestCode('NOSUCH0001', OTHER_PHONE).expect(429)).code).toBe(
      'RATE_LIMITED',
    );
    // Another phone, the same (unknown) EPIC: still limited.
    await requestCode('NOSUCH0001', VOTER_PHONE).expect(429);
  });

  it('a voter session sees nothing but itself', async () => {
    const tokens = await signIn();
    const voter = as(tokens);

    // Booth-scoped reads: nothing, or not found.
    expect((await voter.get('/v1/households').expect(200)).body).toMatchObject({ items: [] });
    await voter.get(`/v1/households/${seedId('household:part1:1')}`).expect(404);
    await voter.get(`/v1/voters/${seedId('voter:part1:1')}`).expect(404);
    expect((await voter.get('/v1/geographies').expect(200)).body).toMatchObject({ items: [] });
    const pull = (await voter.get('/v1/sync/pull').expect(200)).body as Record<string, unknown[]>;
    for (const list of ['households', 'voters', 'fieldValues', 'visits']) {
      expect(pull[list]).toEqual([]);
    }

    // Staff endpoints: 403.
    for (const [method, path] of [
      ['post', '/v1/visits'],
      ['post', '/v1/sync/push'],
      ['get', '/v1/audit-events'],
      ['get', '/v1/users'],
      ['get', `/v1/analytics/nodes/${seedId('node:state')}/summary`],
    ] as const) {
      const res = await voter[method](path).set('Idempotency-Key', 'voter-test-key-1').send({});
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it('a phone that is also a volunteer: the voter session gets no staff rights', async () => {
    // The volunteer's mobile is recorded on voter part1:2 (a volunteer who
    // lives in the booth).
    const mobile = await t.prisma.fieldDefinition.findFirstOrThrow({
      where: { key: 'mobile_number' },
    });
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: seedId('voter:part1:2'),
        fieldDefinitionId: mobile.id,
        value: STAFF_PHONE,
        sourceType: 'admin_corrected',
        collectedById: admin.id,
      },
    });
    await requestCode(otherEpic, STAFF_PHONE).expect(202);
    const tokens = (await verify(otherEpic, STAFF_PHONE, sent.get(STAFF_PHONE)!).expect(200))
      .body as TokenPair;

    // Still one user, the volunteer's.
    const user = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: STAFF_PHONE } });
    const me = await as(tokens).get('/v1/me').expect(200);
    expect(me.body).toMatchObject({
      id: user.id,
      assignments: [],
      voter: { id: seedId('voter:part1:2') },
    });
    expect((await as(tokens).get('/v1/households').expect(200)).body).toMatchObject({ items: [] });
    await as(tokens)
      .post('/v1/sync/push')
      .set('Idempotency-Key', 'voter-test-key-2')
      .send({})
      .expect(403);

    // The volunteer's own session is unchanged.
    const volunteer = await loginAs(t, STAFF_PHONE);
    const own = await volunteer.http.get('/v1/me').expect(200);
    expect(own.body).toMatchObject({ voter: null });
    expect((own.body as { assignments: unknown[] }).assignments).not.toEqual([]);
  });

  it('refresh keeps the voter session, and sign-out ends it', async () => {
    const tokens = await signIn();
    const refreshed = (
      await t
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200)
    ).body as TokenPair;
    expect((await as(refreshed).get('/v1/me').expect(200)).body).toMatchObject({
      voter: { id: seedId('voter:part1:1') },
    });
    await as(refreshed).post('/v1/auth/logout').expect(204);
    await as(refreshed).get('/v1/me').expect(401);
  });

  it('a suspended user is refused, like a wrong code', async () => {
    await signIn(); // makes the voter's user
    await t.prisma.appUser.update({ where: { phone: VOTER_PHONE }, data: { status: 'suspended' } });
    try {
      await requestCode(epic, VOTER_PHONE).expect(202);
      const code = sent.get(VOTER_PHONE)!;
      expect(body(await verify(epic, VOTER_PHONE, code).expect(401)).code).toBe('OTP_INVALID');
    } finally {
      await t.prisma.appUser.update({ where: { phone: VOTER_PHONE }, data: { status: 'active' } });
    }
  });

  it('an EPIC listed twice with the same mobile is ambiguous: no code', async () => {
    // The same EPIC in the other part's roll, with the same mobile on record.
    const original = await t.prisma.voter.findUniqueOrThrow({
      where: { id: seedId('voter:part1:1') },
    });
    const other = await t.prisma.voter.findFirstOrThrow({
      where: { partId: seedId('node:part2'), origin: 'official_import' },
    });
    const twin = await t.prisma.voter.create({
      data: {
        programId: original.programId,
        householdId: other.householdId,
        partId: other.partId,
        pollingStationId: other.pollingStationId,
        sourceVoterId: epic,
        sourceVersionId: other.sourceVersionId,
        importFileId: other.importFileId,
        sourceData: { name: 'Synthetic Twin' },
        sectionNo: other.sectionNo,
        serialNo: 9999,
      },
    });
    const mobile = await t.prisma.fieldDefinition.findFirstOrThrow({
      where: { key: 'mobile_number' },
    });
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: twin.id,
        fieldDefinitionId: mobile.id,
        value: VOTER_PHONE,
        sourceType: 'admin_corrected',
        collectedById: admin.id,
      },
    });
    try {
      await requestCode(epic, VOTER_PHONE).expect(202);
      expect(send).not.toHaveBeenCalled();
    } finally {
      // Out of the way for the other tests (records are never deleted).
      await t.prisma.voter.update({ where: { id: twin.id }, data: { recordStatus: 'deleted' } });
    }
  });

  it('rejects malformed input', async () => {
    expect(body(await requestCode('!!', VOTER_PHONE).expect(400)).code).toBe('VALIDATION_FAILED');
    expect(body(await requestCode(epic, '9876543210').expect(400)).code).toBe('VALIDATION_FAILED');
  });
});
