import { type NextRequest, NextResponse } from 'next/server';

import { callApi, clearSession, COOKIE } from '@/lib/server/session';

/** Ends the API session (best effort) and clears the cookies. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(COOKIE.access)?.value;
  if (token) {
    await callApi('/v1/auth/logout', { method: 'POST', token }).catch(() => undefined);
  }
  const response = new NextResponse(null, { status: 204 });
  clearSession(response);
  return response;
}
