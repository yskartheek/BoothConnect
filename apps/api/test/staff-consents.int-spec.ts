import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { TokenService } from '../src/auth/token.service';
import type { StaffConsent, StaffConsents } from '../src/consents/consents.service';
import { seedId } from '../src/database/seed/random';
import type { SyncPage } from '../src/sync/sync.service';
import type { VoterConsents } from '../src/voter-self/voter-self.service';
import type { MemberEdited } from '../src/voters/voter-writes.service';
import type { VoterDetail } from '../src/voters/voters.service';
import { loginAs, type SignedIn } from './support/auth';
import { createTestApp, type TestApp } from './support/app';

// Staff record a voter's withdrawal of consent, at the voter's request
// (#213). The development seed's demo voter has caste / community shared
// with consent. Synthetic data only.
const VOTER = seedId('voter:part1:1');
const OTHER_VOTER = seedId('voter:part1:2');
const CONSENT = seedId('consent:voter:part1:1:caste_community');
const VALUE = seedId(`value:${VOTER}:caste_community`);

describe('staff withdraw a voter’s consent (real Postgres)', () => {
  let t: TestApp;
  let volunteer: SignedIn;
  let admin: SignedIn;

  beforeAll(async () => {
    t = await createTestApp();
    volunteer = await loginAs(t, '+919999900002');
    admin = await loginAs(t, '+919999900001');
  });

  afterAll(async () => {
    await t?.close();
  });

  const withdraw = (who: SignedIn, voterId: string, consentId: string) =>
    who.http
      .post(`/v1/voters/${voterId}/consents/${consentId}/withdraw`)
      .set('Idempotency-Key', randomUUID());

  const caste = async () =>
    ((await volunteer.http.get(`/v1/voters/${VOTER}`).expect(200)).body as VoterDetail).fields.find(
      (f) => f.key === 'caste_community',
    )!.current;

  async function pullAll(since = '') {
    let cursor = since;
    const removed: string[] = [];
    for (let more = true; more;) {
      const page = (
        await volunteer.http
          .get('/v1/sync/pull')
          .query(cursor ? { since: cursor } : {})
          .expect(200)
      ).body as SyncPage;
      removed.push(...page.removedFieldValueIds);
      cursor = page.cursor;
      more = page.hasMore;
    }
    return { cursor, removed };
  }

  it('lists the voter’s consents, with who recorded each', async () => {
    const { items } = (await volunteer.http.get(`/v1/voters/${VOTER}/consents`).expect(200))
      .body as StaffConsents;
    expect(items).toEqual([
      expect.objectContaining({
        id: CONSENT,
        purpose: 'caste_community',
        labelKey: 'field.caste_community',
        method: 'in_person_verbal',
        status: 'granted',
        withdrawnAt: null,
        capturedBy: { id: volunteer.userId, name: expect.any(String) },
        withdrawnBy: null,
      }),
    ]);
  });

  it('the volunteer withdraws it at the voter’s request: hidden everywhere at once', async () => {
    expect(await caste()).toHaveLength(1);
    const { cursor } = await pullAll();

    const res = await withdraw(volunteer, VOTER, CONSENT).expect(200);
    expect(res.body as StaffConsent).toMatchObject({
      id: CONSENT,
      status: 'withdrawn',
      withdrawnAt: expect.any(String),
      withdrawnBy: { id: volunteer.userId },
    });

    // Not returned, and the volunteer's phone is told to delete it.
    expect(await caste()).toEqual([]);
    expect((await pullAll(cursor)).removed).toContain(VALUE);

    // Audited: who, for which purpose, on whose behalf; never the value.
    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'consent.withdraw', resourceId: CONSENT },
    });
    expect(audit).toMatchObject({ actorId: volunteer.userId, result: 'success' });
    expect(audit.metadata).toEqual({ purpose: 'caste_community', by: 'volunteer' });
    expect(JSON.stringify(audit.metadata)).not.toContain('Synthetic community');
  });

  it('withdrawing again changes nothing; the voter sees it withdrawn, without staff names', async () => {
    const before = await t.prisma.consent.findUniqueOrThrow({ where: { id: CONSENT } });
    const again = (await withdraw(admin, VOTER, CONSENT).expect(200)).body as StaffConsent;
    expect(again.withdrawnBy).toMatchObject({ id: volunteer.userId });
    const after = await t.prisma.consent.findUniqueOrThrow({ where: { id: CONSENT } });
    expect(after.withdrawnAt).toEqual(before.withdrawnAt);
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'consent.withdraw', resourceId: CONSENT },
      }),
    ).toBe(1);

    const voterUser = await t.prisma.appUser.create({
      data: {
        organizationId: (await t.prisma.appUser.findUniqueOrThrow({ where: { id: admin.userId } }))
          .organizationId,
        name: 'Synthetic Voter',
        phone: '+919999900111',
      },
    });
    const { tokens } = await t.app
      .get(TokenService)
      .startSession(voterUser.id, 'voter-device', VOTER);
    const own = (
      await request(t.app.getHttpServer())
        .get('/v1/voter/me/consents')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200)
    ).body as VoterConsents;
    expect(own.items).toEqual([expect.objectContaining({ id: CONSENT, status: 'withdrawn' })]);
    expect(Object.keys(own.items[0]!)).not.toContain('withdrawnBy');
    expect(Object.keys(own.items[0]!)).not.toContain('capturedBy');

    // A voter's session can't use the staff routes.
    await request(t.app.getHttpServer())
      .get(`/v1/voters/${VOTER}/consents`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(403);
  });

  it('a new value needs a new consent', async () => {
    const write = (consentId: string) =>
      volunteer.http
        .patch(`/v1/voters/${VOTER}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          fields: [
            { fieldKey: 'caste_community', value: 'Synthetic again', baseVersion: null, consentId },
          ],
        })
        .expect(200);
    const refused = (await write(CONSENT)).body as MemberEdited;
    expect(refused.fields[0]).toMatchObject({ status: 'rejected', code: 'CONSENT_REQUIRED' });

    const fresh = await t.prisma.consent.create({
      data: {
        subjectVoterId: VOTER,
        purpose: 'caste_community',
        noticeVersion: '2026.1',
        capturedMethod: 'in_person_verbal',
        capturedById: volunteer.userId,
      },
    });
    const applied = (await write(fresh.id)).body as MemberEdited;
    expect(applied.fields[0]).toMatchObject({ status: 'applied' });
    expect(await caste()).toEqual([expect.objectContaining({ value: 'Synthetic again' })]);
    // It replaces the hidden value: one current value, no conflict.
    expect(applied.fields[0]).toMatchObject({ supersedesId: VALUE });
    expect(
      await t.prisma.fieldValue.count({
        where: { entityId: VOTER, isCurrent: true, fieldDefinition: { key: 'caste_community' } },
      }),
    ).toBe(1);

    // An admin can record a withdrawal too.
    const res = (await withdraw(admin, VOTER, fresh.id).expect(200)).body as StaffConsent;
    expect(res.withdrawnBy).toMatchObject({ id: admin.userId });
    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'consent.withdraw', resourceId: fresh.id },
    });
    expect(audit.metadata).toEqual({ purpose: 'caste_community', by: 'admin' });
    expect(await caste()).toEqual([]);
  });

  it('another voter’s consent, or an unknown one, is 404 and unchanged', async () => {
    const other = await t.prisma.consent.create({
      data: {
        subjectVoterId: OTHER_VOTER,
        purpose: 'caste_community',
        noticeVersion: '2026.1',
        capturedMethod: 'in_person_verbal',
      },
    });
    await withdraw(volunteer, VOTER, other.id).expect(404);
    await withdraw(volunteer, VOTER, randomUUID()).expect(404);
    await withdraw(volunteer, randomUUID(), other.id).expect(404);
    expect((await t.prisma.consent.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      'granted',
    );
  });

  it('two withdrawals at once: both succeed, one change', async () => {
    const consent = await t.prisma.consent.create({
      data: {
        subjectVoterId: OTHER_VOTER,
        purpose: 'caste_community',
        noticeVersion: '2026.1',
        capturedMethod: 'in_person_verbal',
      },
    });
    const results = await Promise.all([
      withdraw(volunteer, OTHER_VOTER, consent.id).expect(200),
      withdraw(admin, OTHER_VOTER, consent.id).expect(200),
    ]);
    expect(results.map((r) => (r.body as StaffConsent).status)).toEqual(['withdrawn', 'withdrawn']);
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'consent.withdraw', resourceId: consent.id },
      }),
    ).toBe(1);
  });
});
