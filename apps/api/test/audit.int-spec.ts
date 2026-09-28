import { Controller, ForbiddenException, Get, Param } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AuditService } from '../src/audit/audit.service';
import { Audited } from '../src/audit/audited';
import { OTP_SENDER, type OtpSender } from '../src/auth/otp-sender';
import { otpKey, otpRateKey } from '../src/auth/otp.service';
import { REDIS } from '../src/redis/redis.module';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// A user only this test file signs in with (Redis is shared between files).
const PHONE = '+919999900066';

// A route audited with @Audited(), for these tests only.
@Controller('test-audit')
class AuditedTestController {
  @Audited({ action: 'thing.read', resourceType: 'thing' })
  @Get('things/:id')
  read(@Param('id') id: string): { id: string } {
    if (id === 'forbidden') throw new ForbiddenException();
    return { id };
  }
}

describe('audit log (real Postgres)', () => {
  let t: TestApp;
  let userId: string;
  const codes = new Map<string, string>();
  const sender: OtpSender = {
    send: (phone, code) => {
      codes.set(phone, code);
      return Promise.resolve();
    },
  };
  const clearOtp = () => t.app.get<Redis>(REDIS).del(otpKey(PHONE), otpRateKey(PHONE));
  // Events hold a bigint (seq); serialize it to search the whole row as text.
  const text = (value: unknown) =>
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  const events = (action: string) =>
    t.prisma.auditEvent.findMany({ where: { action }, orderBy: { seq: 'asc' } });

  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(OTP_SENDER).useValue(sender), {
      controllers: [AuditedTestController],
    });
    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: '+919999900001' } });
    userId = (
      await t.prisma.appUser.create({
        data: { organizationId: admin.organizationId, name: 'Audit test user', phone: PHONE },
      })
    ).id;
    await clearOtp();
  });

  afterAll(async () => {
    await clearOtp();
    await t?.close();
  });

  const signIn = async (status: number, code?: string) => {
    await t.http().post('/v1/auth/otp/request').send({ phone: PHONE }).expect(202);
    return t
      .http()
      .post('/v1/auth/otp/verify')
      .send({ phone: PHONE, code: code ?? codes.get(PHONE), deviceId: 'audit-device' })
      .expect(status);
  };

  it('a successful sign-in writes auth.login success with actor, session and request ID', async () => {
    const res = await signIn(200);
    const [event] = await events('auth.login');

    expect(event).toMatchObject({
      actorId: userId,
      resourceType: 'session',
      result: 'success',
      requestId: res.headers['x-request-id'],
      metadata: {},
    });
    expect(event?.sessionId).toBe(event?.resourceId);
    expect(event?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a failed sign-in writes auth.login failure with the reason, and no phone or code', async () => {
    const before = (await events('auth.login')).length;
    await signIn(401, '000000');

    const all = await events('auth.login');
    expect(all).toHaveLength(before + 1);
    const event = all.at(-1);
    expect(event).toMatchObject({
      actorId: userId,
      result: 'failure',
      sessionId: null,
      metadata: { reason: 'OTP_INVALID' },
    });
    expect(text(event)).not.toContain(PHONE);
    expect(text(event)).not.toContain('000000');
  });

  it('logout writes auth.logout for the session', async () => {
    const { http, tokens } = await loginAs(t, PHONE);
    await http.post('/v1/auth/logout').expect(204);

    const [event] = await events('auth.logout');
    expect(event).toMatchObject({ actorId: userId, result: 'success', resourceType: 'session' });
    expect(event?.resourceId).toBe(event?.sessionId);
    expect(text(event)).not.toContain(tokens.accessToken);
  });

  it('@Audited() records success, and failure with the error code, then re-throws', async () => {
    const { http } = await loginAs(t, PHONE);
    await http.get('/v1/test-audit/things/abc').expect(200);
    await http.get('/v1/test-audit/things/forbidden').expect(403);

    const [ok, failed] = await events('thing.read');
    expect(ok).toMatchObject({ result: 'success', resourceId: 'abc', actorId: userId });
    expect(failed).toMatchObject({
      result: 'failure',
      resourceId: 'forbidden',
      metadata: { reason: 'FORBIDDEN' },
    });
  });

  it('redacts secrets and personal data in metadata', async () => {
    await t.app.get(AuditService).record({
      action: 'test.redaction',
      resourceType: 'test',
      result: 'success',
      metadata: { refreshToken: 'secret-token', phone: PHONE, reason: 'kept' },
    });
    const [event] = await events('test.redaction');
    expect(event?.metadata).toEqual({
      refreshToken: '[REDACTED]',
      phone: '[REDACTED]',
      reason: 'kept',
    });
  });

  it('the chain verifies intact across all events written above', async () => {
    expect(await t.prisma.auditEvent.count()).toBeGreaterThanOrEqual(6);
    await expect(t.app.get(AuditService).verifyChain()).resolves.toBeNull();
  });
});
