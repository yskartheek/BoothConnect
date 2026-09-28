import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

// Seed user (synthetic), in this file's own database.
const VOLUNTEER_B = '+919999900003';

describe('suspended users (real Postgres)', () => {
  let t: TestApp;
  const setStatus = (userId: string, status: 'active' | 'suspended') =>
    t.prisma.appUser.update({ where: { id: userId }, data: { status } });

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('plan §8: a suspended user’s still-valid access token gets 401 on the next request', async () => {
    const phone = await loginAs(t, VOLUNTEER_B, 'phone');
    const tablet = await loginAs(t, VOLUNTEER_B, 'tablet');

    await setStatus(phone.userId, 'suspended');

    // The access token itself is valid for 15 more minutes; it is refused anyway.
    const res = await phone.http.post('/v1/auth/logout').expect(401);
    expect((res.body as ApiErrorBody).code).toBe('UNAUTHENTICATED');

    // No new tokens either.
    await t
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: tablet.tokens.refreshToken })
      .expect(401);

    // Suspension doesn't end the sessions: once reactivated, the devices work
    // again without signing in.
    await setStatus(phone.userId, 'active');
    await t
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: tablet.tokens.refreshToken })
      .expect(200);
    await phone.http.post('/v1/auth/logout').expect(204);
  });
});
