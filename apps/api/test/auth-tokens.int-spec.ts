import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';

import { retiredRefreshKey, TokenService } from '../src/auth/token.service';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { REDIS } from '../src/redis/redis.module';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// Seed users (synthetic), in this file's own database.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

describe('access tokens, refresh rotation and logout (real Postgres and Redis)', () => {
  let t: TestApp;
  const body = (res: { body: unknown }) => res.body as ApiErrorBody;
  const retiredKeys: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    if (retiredKeys.length > 0) await t?.app.get<Redis>(REDIS).del(...retiredKeys);
    await t?.close();
  });

  const refresh = (refreshToken: string) =>
    t.http().post('/v1/auth/refresh').send({ refreshToken });
  const logout = (accessToken: string) =>
    t.http().post('/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);
  const sessionOf = (accessToken: string) => {
    const [, payload] = accessToken.split('.');
    const { sid } = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as {
      sid: string;
    };
    return t.prisma.session.findUniqueOrThrow({ where: { id: sid } });
  };
  const remember = (refreshToken: string) =>
    retiredKeys.push(retiredRefreshKey(t.app.get(TokenService).hashRefreshToken(refreshToken)));

  describe('protected routes', () => {
    it('reject a request without a token with 401 UNAUTHENTICATED', async () => {
      const res = await t.http().post('/v1/auth/logout').expect(401);
      expect(body(res)).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it.each([
      ['not a JWT', 'Bearer not-a-token'],
      ['a different scheme', 'Basic dXNlcjpwYXNz'],
      ['an empty bearer', 'Bearer '],
    ])('reject %s', async (_name, header) => {
      await t.http().post('/v1/auth/logout').set('Authorization', header).expect(401);
    });

    it('reject a token signed with another secret', async () => {
      const { userId, tokens } = await loginAs(t, ADMIN);
      const session = await sessionOf(tokens.accessToken);
      const forged = await t.app
        .get(JwtService)
        .signAsync({ sub: userId, sid: session.id }, { secret: 'x'.repeat(40), expiresIn: 60 });
      await logout(forged).expect(401);
    });

    it('reject an expired access token', async () => {
      const { userId, tokens } = await loginAs(t, ADMIN);
      const session = await sessionOf(tokens.accessToken);
      const expired = await t.app
        .get(JwtService)
        .signAsync(
          { sub: userId, sid: session.id, exp: Math.floor(Date.now() / 1000) - 10 },
          { secret: t.app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET') },
        );
      await logout(expired).expect(401);
    });

    it('reject a token whose session has expired', async () => {
      const { tokens } = await loginAs(t, ADMIN);
      const session = await sessionOf(tokens.accessToken);
      await t.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await logout(tokens.accessToken).expect(401);
    });

    it('stay open for @Public() routes', async () => {
      await t
        .http()
        .get('/v1/health')
        .expect((res) => expect([200, 503]).toContain(res.status));
    });
  });

  it('loginAs gives an agent that is signed in', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    await http.post('/v1/auth/logout').expect(204);
  });

  it('refresh rotates the refresh token and issues a new access token', async () => {
    const { tokens } = await loginAs(t, ADMIN);
    remember(tokens.refreshToken);

    const res = await refresh(tokens.refreshToken).expect(200);
    const next = res.body as typeof tokens;
    remember(next.refreshToken);
    expect(next).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(next.refreshToken).not.toBe(tokens.refreshToken);

    // Same session; the new pair works, and the session stores the new hash.
    const session = await sessionOf(next.accessToken);
    expect(session.id).toBe((await sessionOf(tokens.accessToken)).id);
    expect(session.refreshHash).toBe(t.app.get(TokenService).hashRefreshToken(next.refreshToken));
    await refresh(next.refreshToken).expect(200);
  });

  it('a reused old refresh token gets 401 and revokes the whole session', async () => {
    const { tokens } = await loginAs(t, ADMIN);
    remember(tokens.refreshToken);
    const next = (await refresh(tokens.refreshToken).expect(200)).body as typeof tokens;
    remember(next.refreshToken);

    // Replaying the rotated-away token is refused ...
    const replay = await refresh(tokens.refreshToken).expect(401);
    expect(body(replay).code).toBe('UNAUTHENTICATED');

    // ... and ends the session: the current tokens stop working too.
    const session = await sessionOf(next.accessToken);
    expect(session.revokedAt).not.toBeNull();
    await refresh(next.refreshToken).expect(401);
    await logout(next.accessToken).expect(401);
  });

  it('an unknown refresh token gets 401', async () => {
    await refresh('never-issued-token').expect(401);
  });

  it('after logout, the access token and the refresh token get 401', async () => {
    const { tokens } = await loginAs(t, VOLUNTEER_A);
    await logout(tokens.accessToken).expect(204);

    const session = await sessionOf(tokens.accessToken);
    expect(session.revokedAt).not.toBeNull();
    await logout(tokens.accessToken).expect(401);
    await refresh(tokens.refreshToken).expect(401);
  });

  it('logout ends only that device, not the user’s other sessions', async () => {
    const phone = await loginAs(t, ADMIN, 'phone');
    const tablet = await loginAs(t, ADMIN, 'tablet');
    await phone.http.post('/v1/auth/logout').expect(204);
    await tablet.http.post('/v1/auth/logout').expect(204);
  });
});
