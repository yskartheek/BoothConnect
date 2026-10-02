import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';
import request from 'supertest';

import type { TokenPair } from '../src/auth/dto';
import { OTP_SENDER, type OtpSender } from '../src/auth/otp-sender';
import { epicRateKey, otpRateKey, voterOtpKey } from '../src/auth/otp.service';
import { seedId } from '../src/database/seed/random';
import { REDIS } from '../src/redis/redis.module';
import type { SyncFieldValue, SyncPage } from '../src/sync/sync.service';
import type {
  VoterDetailsEdited,
  VoterSelf,
  VoterUpdates,
} from '../src/voter-self/voter-self.service';
import { loginAs } from './support/auth';
import { createTestApp, type TestApp } from './support/app';

// The voter prototype end to end (#229), over HTTP against the real API,
// Postgres and Redis: a voter signs in, edits their occupation and sees it in
// Updates, and the booth volunteer's next pull has the new value. Synthetic
// data only. Redis is shared between test files, so this voter and phone are
// used only here.
const VOTER = seedId('voter:part1:5');
const VOTER_PHONE = '+919999900105';

describe('voter prototype end to end (real Postgres and Redis)', () => {
  let t: TestApp;
  let redis: Redis;
  let epic: string;
  const sent = new Map<string, string>();
  const sender: OtpSender = {
    send: (phone, code) => {
      sent.set(phone, code);
      return Promise.resolve();
    },
  };
  const keys = () => [otpRateKey(VOTER_PHONE), epicRateKey(epic), voterOtpKey(epic, VOTER_PHONE)];

  beforeAll(async () => {
    t = await createTestApp((builder) => builder.overrideProvider(OTP_SENDER).useValue(sender));
    redis = t.app.get<Redis>(REDIS);
    epic = (await t.prisma.voter.findUniqueOrThrow({ where: { id: VOTER } })).sourceVoterId!;
    await redis.del(...keys());

    // The booth volunteer recorded the voter's mobile number on a visit.
    const volunteer = await t.prisma.appUser.findUniqueOrThrow({
      where: { phone: '+919999900002' },
    });
    await t.prisma.fieldValue.create({
      data: {
        entityType: 'voter',
        entityId: VOTER,
        fieldDefinition: { connect: { id: seedId('field:mobile_number') } },
        value: VOTER_PHONE,
        sourceType: 'volunteer_collected',
        collectedBy: { connect: { id: volunteer.id } },
      },
    });
  });

  afterAll(async () => {
    await redis?.del(...keys());
    await t?.close();
  });

  it('a voter edits their occupation; Updates shows it and the volunteer’s next pull has it', async () => {
    // The volunteer's phone is up to date.
    const volunteer = await loginAs(t, '+919999900002');
    const pull = async (since?: string) => {
      const values: SyncFieldValue[] = [];
      let cursor = since ?? '';
      for (let more = true; more;) {
        const page = (
          await volunteer.http
            .get('/v1/sync/pull')
            .query(cursor ? { since: cursor } : {})
            .expect(200)
        ).body as SyncPage;
        values.push(...page.fieldValues);
        cursor = page.cursor;
        more = page.hasMore;
      }
      return { values, cursor };
    };
    const { cursor } = await pull();

    // Sign in with the voter ID and the mobile number on record.
    await t
      .http()
      .post('/v1/voter-auth/otp/request')
      .send({ epic: epic.toLowerCase(), phone: VOTER_PHONE })
      .expect(202);
    const code = sent.get(VOTER_PHONE)!;
    const tokens = (
      await t
        .http()
        .post('/v1/voter-auth/otp/verify')
        .send({ epic, phone: VOTER_PHONE, code, deviceId: 'voter-phone' })
        .expect(200)
    ).body as TokenPair;
    const voter = request
      .agent(t.app.getHttpServer())
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    const me = (await voter.get('/v1/me').expect(200)).body as { voter: { id: string } | null };
    expect(me.voter).toEqual({ id: VOTER });

    // Edit the occupation, based on what the app showed.
    const self = (await voter.get('/v1/voter/me').expect(200)).body as VoterSelf;
    const occupation = self.shared.find((d) => d.key === 'occupation')!;
    const edited = (
      await voter
        .patch('/v1/voter/me/details')
        .set('Idempotency-Key', randomUUID())
        .send({
          fields: [
            {
              fieldKey: 'occupation',
              value: 'Synthetic Weaver',
              baseVersion: occupation.fieldValueId,
            },
          ],
        })
        .expect(200)
    ).body as VoterDetailsEdited;
    expect(edited.fields).toEqual([
      expect.objectContaining({ fieldKey: 'occupation', status: 'applied' }),
    ]);
    const after = (await voter.get('/v1/voter/me').expect(200)).body as VoterSelf;
    expect(after.shared.find((d) => d.key === 'occupation')?.value).toBe('Synthetic Weaver');

    // Updates: the voter's own change comes first, without the value.
    const { items } = (await voter.get('/v1/voter/me/updates').expect(200)).body as VoterUpdates;
    expect(items[0]).toMatchObject({ kind: 'detail', fieldKey: 'occupation', by: 'you' });
    expect(JSON.stringify(items)).not.toContain('Synthetic Weaver');

    // The volunteer's next pull has the new value, marked as the voter's.
    const next = await pull(cursor);
    expect(next.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: VOTER,
          fieldKey: 'occupation',
          value: 'Synthetic Weaver',
          sourceType: 'voter_self_submitted',
          isCurrent: true,
        }),
      ]),
    );
  });
});
