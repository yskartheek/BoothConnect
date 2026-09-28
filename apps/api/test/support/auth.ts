import request from 'supertest';

import type { TokenPair } from '../../src/auth/dto';
import { TokenService } from '../../src/auth/token.service';
import type { TestApp } from './app';

export interface SignedIn {
  userId: string;
  tokens: TokenPair;
  /** A supertest agent that sends `Authorization: Bearer <access token>`. */
  http: ReturnType<typeof request.agent>;
}

/**
 * Signs a user in without the OTP round trip: starts a session for them the
 * same way a successful `otp/verify` does. `who` is a user ID or a phone.
 */
export async function loginAs(
  t: TestApp,
  who: string,
  deviceId = 'test-device',
): Promise<SignedIn> {
  const user = await t.prisma.appUser.findFirstOrThrow({
    where: who.startsWith('+') ? { phone: who } : { id: who },
  });
  const { tokens } = await t.app.get(TokenService).startSession(user.id, deviceId);
  const http = request
    .agent(t.app.getHttpServer())
    .set('Authorization', `Bearer ${tokens.accessToken}`);
  return { userId: user.id, tokens, http };
}
