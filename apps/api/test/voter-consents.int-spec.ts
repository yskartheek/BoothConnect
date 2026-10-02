import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { TokenService } from '../src/auth/token.service';
import { seedId } from '../src/database/seed/random';
import type { MemberEdited } from '../src/voters/voter-writes.service';
import type { VoterConsent, VoterConsents } from '../src/voter-self/voter-self.service';
import type { VoterDetail } from '../src/voters/voters.service';
import { loginAs, type SignedIn } from './support/auth';
import { createTestApp, type TestApp } from './support/app';

// A voter's consents (#225). Synthetic seed data only.
const VOTER = seedId('voter:part1:1');
const OTHER_VOTER = seedId('voter:part1:2');

describe('voter consents (real Postgres)', () => {
  let t: TestApp;
  let voterUserId: string;
  let volunteer: SignedIn;
  let consentId: string;
  let valueId: string;
  let otherConsentId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    voterUserId = (
      await t.prisma.appUser.create({
        data: {
          organizationId: admin.organizationId,
          name: 'Synthetic Voter',
          phone: '+919999900101',
        },
      })
    ).id;
    volunteer = await loginAs(t, '+919999900002');

    // Caste / community, recorded by the volunteer with the voter's consent:
    // the development seed's (#229).
    consentId = seedId('consent:voter:part1:1:caste_community');
    valueId = seedId(`value:${VOTER}:caste_community`);
    expect(await t.prisma.fieldValue.findUniqueOrThrow({ where: { id: valueId } })).toMatchObject({
      consentId,
      isCurrent: true,
    });
    otherConsentId = (
      await t.prisma.consent.create({
        data: {
          subjectVoterId: OTHER_VOTER,
          purpose: 'caste_community',
          noticeVersion: '2026.1',
          capturedMethod: 'in_person_verbal',
          capturedById: volunteer.userId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await t?.close();
  });

  async function asVoter() {
    const { tokens } = await t.app
      .get(TokenService)
      .startSession(voterUserId, 'voter-device', VOTER);
    return request
      .agent(t.app.getHttpServer())
      .set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  const withdraw = async (id: string, status = 200) =>
    (await asVoter())
      .post(`/v1/voter/me/consents/${id}/withdraw`)
      .set('Idempotency-Key', randomUUID())
      .send()
      .expect(status);

  const casteOnVolunteerView = async () =>
    ((await volunteer.http.get(`/v1/voters/${VOTER}`).expect(200)).body as VoterDetail).fields.find(
      (f) => f.key === 'caste_community',
    )!.current;

  it('lists the voter’s consents, and only theirs', async () => {
    const { items } = (await (await asVoter()).get('/v1/voter/me/consents').expect(200))
      .body as VoterConsents;
    expect(items).toEqual([
      expect.objectContaining({
        id: consentId,
        purpose: 'caste_community',
        labelKey: expect.stringContaining('caste'),
        noticeVersion: '2026.1',
        method: 'in_person_verbal',
        status: 'granted',
        withdrawnAt: null,
      }),
    ]);
  });

  it('withdrawing hides the values everywhere, and phones are told to delete them', async () => {
    expect(await casteOnVolunteerView()).toHaveLength(1);
    // The volunteer's phone is up to date before the withdrawal.
    let cursor = '';
    for (let more = true; more;) {
      const page = (
        await volunteer.http
          .get('/v1/sync/pull')
          .query(cursor ? { since: cursor } : {})
          .expect(200)
      ).body as { cursor: string; hasMore: boolean };
      cursor = page.cursor;
      more = page.hasMore;
    }

    const res = await withdraw(consentId);
    expect(res.body as VoterConsent).toMatchObject({
      id: consentId,
      status: 'withdrawn',
      withdrawnAt: expect.any(String),
    });
    const stored = await t.prisma.consent.findUniqueOrThrow({ where: { id: consentId } });
    expect(stored.withdrawnById).toBe(voterUserId);

    expect(await casteOnVolunteerView()).toEqual([]);
    const pull = (await volunteer.http.get('/v1/sync/pull').query({ since: cursor }).expect(200))
      .body as { removedFieldValueIds: string[] };
    expect(pull.removedFieldValueIds).toContain(valueId);

    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'consent.withdraw', resourceId: consentId },
    });
    expect(audit).toMatchObject({ actorId: voterUserId, result: 'success' });
    expect(JSON.stringify(audit.metadata)).not.toContain('Synthetic community');
  });

  it('withdrawing again changes nothing', async () => {
    const before = await t.prisma.consent.findUniqueOrThrow({ where: { id: consentId } });
    const res = await withdraw(consentId);
    expect((res.body as VoterConsent).status).toBe('withdrawn');
    const after = await t.prisma.consent.findUniqueOrThrow({ where: { id: consentId } });
    expect(after.withdrawnAt).toEqual(before.withdrawnAt);
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'consent.withdraw', resourceId: consentId },
      }),
    ).toBe(1);
  });

  it('two withdrawals at once: both succeed, one change', async () => {
    const consent = await t.prisma.consent.create({
      data: {
        subjectVoterId: VOTER,
        purpose: 'caste_community',
        noticeVersion: '2026.1',
        capturedMethod: 'in_person_verbal',
        capturedById: volunteer.userId,
      },
    });
    const results = await Promise.all([withdraw(consent.id), withdraw(consent.id)]);
    expect(results.map((r) => (r.body as VoterConsent).status)).toEqual(['withdrawn', 'withdrawn']);
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'consent.withdraw', resourceId: consent.id },
      }),
    ).toBe(1);
  });

  it('a withdrawn consent can’t cover a new value', async () => {
    const res = await volunteer.http
      .patch(`/v1/voters/${VOTER}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        fields: [
          { fieldKey: 'caste_community', value: 'Synthetic again', baseVersion: null, consentId },
        ],
      })
      .expect(200);
    expect((res.body as MemberEdited).fields[0]).toMatchObject({
      status: 'rejected',
      code: 'CONSENT_REQUIRED',
    });
  });

  it('another person’s consent is not found; staff can’t use this', async () => {
    await withdraw(otherConsentId, 404);
    await withdraw(randomUUID(), 404);
    expect(
      (await t.prisma.consent.findUniqueOrThrow({ where: { id: otherConsentId } })).status,
    ).toBe('granted');

    await volunteer.http.get('/v1/voter/me/consents').expect(403);
    await volunteer.http
      .post(`/v1/voter/me/consents/${consentId}/withdraw`)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
  });
});
