import { type NextRequest, NextResponse } from 'next/server';

import {
  callApi,
  clearSession,
  COOKIE,
  errorBody,
  setDevice,
  setMfa,
  setTokens,
  type TokenPair,
} from '@/lib/server/session';

interface Me {
  assignments: { role: string }[];
}

/**
 * Step 2 of sign-in: exchange the code for tokens, kept in httpOnly cookies.
 * Only admins may use the portal: anyone else is signed out again at once
 * and told so (403 NOT_ADMIN).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { phone, code } = (await request.json().catch(() => ({}))) as {
    phone?: unknown;
    code?: unknown;
  };
  const known = request.cookies.get(COOKIE.device)?.value;
  const deviceId = known ?? `admin-web-${crypto.randomUUID()}`;

  const verified = await callApi('/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone, code, deviceId },
  });
  if (!verified.ok) {
    return NextResponse.json(await verified.json().catch(() => null), {
      status: verified.status,
    });
  }
  const tokens = (await verified.json()) as TokenPair;

  const me = await callApi('/v1/me', { token: tokens.accessToken });
  const isAdmin = me.ok && ((await me.json()) as Me).assignments.some((a) => a.role === 'admin');
  if (!isAdmin) {
    await callApi('/v1/auth/logout', { method: 'POST', token: tokens.accessToken }).catch(
      () => undefined,
    );
    const denied = NextResponse.json(errorBody('NOT_ADMIN', 'This portal is for admins'), {
      status: 403,
    });
    clearSession(denied);
    return denied;
  }

  const response = NextResponse.json({ next: '/sign-in/mfa' });
  setTokens(response, tokens);
  setMfa(response, 'pending');
  if (!known) setDevice(response, deviceId);
  return response;
}
