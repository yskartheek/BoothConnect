import type { Redis } from 'ioredis';

import { OTP_SENDER, type OtpSender } from '../src/auth/otp-sender';
import { otpKey, otpRateKey } from '../src/auth/otp.service';
import { TokenService } from '../src/auth/token.service';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { REDIS } from '../src/redis/redis.module';
import { createTestApp, type TestApp } from './support/app';

// Seed users (synthetic) in this file's own database. Redis is shared between
// test files, so only this file uses these phones for sign-in.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';
const SUSPENDED = '+919999900099';
const UNKNOWN = '+919999999990';
const UNKNOWN_2 = '+919999999991';
const PHONES = [ADMIN, VOLUNTEER_A, VOLUNTEER_B, SUSPENDED, UNKNOWN, UNKNOWN_2];

function decodeJwt(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<string, unknown>;
}

describe('OTP sign-in (real Postgres and Redis)', () => {
  let t: TestApp;
  let redis: Redis;
  const sent = new Map<string, string>();
  const send = jest.fn((phone: string, code: string) => {
    sent.set(phone, code);
    return Promise.resolve();
  });
  const sender: OtpSender = { send };
  const body = (res: { body: unknown }) => res.body as ApiErrorBody;

  beforeAll(async () => {
    t = await createTestApp((builder) => builder.overrideProvider(OTP_SENDER).useValue(sender));
    redis = t.app.get<Redis>(REDIS);
    await redis.del(...PHONES.flatMap((phone) => [otpKey(phone), otpRateKey(phone)]));

    const admin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
    await t.prisma.appUser.create({
      data: {
        organizationId: admin.organizationId,
        name: 'Suspended user',
        phone: SUSPENDED,
        status: 'suspended',
      },
    });
  });

  afterAll(async () => {
    await redis?.del(...PHONES.flatMap((phone) => [otpKey(phone), otpRateKey(phone)]));
    await t?.close();
  });

  beforeEach(() => {
    send.mockClear();
    sent.clear();
  });

  const request = (phone: string) => t.http().post('/v1/auth/otp/request').send({ phone });
  const verify = (phone: string, code: string) =>
    t.http().post('/v1/auth/otp/verify').send({ phone, code, deviceId: 'test-device-1' });

  it('answers 202 for an unknown phone, and stores and sends nothing', async () => {
    await request(UNKNOWN).expect(202);
    expect(send).not.toHaveBeenCalled();
    await expect(redis.exists(otpKey(UNKNOWN))).resolves.toBe(0);
  });

  it('answers 202 for a suspended user, and sends nothing', async () => {
    await request(SUSPENDED).expect(202);
    expect(send).not.toHaveBeenCalled();
    await expect(redis.exists(otpKey(SUSPENDED))).resolves.toBe(0);
  });

  it('rejects a phone that is not in international format', async () => {
    const res = await request('9876543210').expect(400);
    expect(body(res).code).toBe('VALIDATION_FAILED');
  });

  it('stores the code only as a keyed hash, with a TTL', async () => {
    await request(ADMIN).expect(202);
    const code = sent.get(ADMIN) ?? '';
    expect(code).toMatch(/^\d{6}$/);

    const stored = await redis.hgetall(otpKey(ADMIN));
    expect(stored).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{64}$/), attempts: '0' });
    expect(JSON.stringify(stored)).not.toContain(code);
    const ttl = await redis.ttl(otpKey(ADMIN));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it('signs in with the right code: tokens, a session, and a single-use code', async () => {
    await request(ADMIN).expect(202);
    const code = sent.get(ADMIN) ?? '';

    const res = await verify(ADMIN, code).expect(200);
    const tokens = res.body as {
      accessToken: string;
      refreshToken: string;
      tokenType: string;
      expiresIn: number;
    };
    expect(tokens).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      tokenType: 'Bearer',
      expiresIn: 900,
    });

    const user = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
    const claims = decodeJwt(tokens.accessToken);
    expect(claims.sub).toBe(user.id);
    expect(user.lastLoginAt).not.toBeNull();

    // The session stores a hash of the refresh token, never the token.
    const session = await t.prisma.session.findUniqueOrThrow({ where: { id: String(claims.sid) } });
    expect(session).toMatchObject({ userId: user.id, deviceId: 'test-device-1', revokedAt: null });
    expect(session.refreshHash).not.toBe(tokens.refreshToken);
    expect(session.refreshHash).toBe(t.app.get(TokenService).hashRefreshToken(tokens.refreshToken));
    expect(session.refreshHash).toMatch(/^[0-9a-f]{64}$/);

    // The code works once.
    const again = await verify(ADMIN, code).expect(401);
    expect(body(again).code).toBe('OTP_INVALID');
  });

  it('rejects a wrong code, and locks the code after five wrong attempts', async () => {
    await request(VOLUNTEER_A).expect(202);
    const code = sent.get(VOLUNTEER_A) ?? '';
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await verify(VOLUNTEER_A, wrong).expect(401);
      expect(body(res).code).toBe('OTP_INVALID');
    }
    const locked = await verify(VOLUNTEER_A, wrong).expect(401);
    expect(body(locked).code).toBe('OTP_LOCKED');

    // The code is gone: even the right one no longer works.
    const after = await verify(VOLUNTEER_A, code).expect(401);
    expect(body(after).code).toBe('OTP_INVALID');
    await expect(redis.exists(otpKey(VOLUNTEER_A))).resolves.toBe(0);
  });

  it('rejects a code when none was requested', async () => {
    const res = await verify(VOLUNTEER_B, '123456').expect(401);
    expect(body(res).code).toBe('OTP_INVALID');
  });

  it.each([
    ['a registered phone', VOLUNTEER_B],
    ['an unknown phone', UNKNOWN_2],
  ])('limits code requests per phone, for %s alike', async (_name, phone) => {
    for (let i = 1; i <= 3; i += 1) await request(phone).expect(202);
    const res = await request(phone).expect(429);
    expect(body(res).code).toBe('RATE_LIMITED');
  });
});
