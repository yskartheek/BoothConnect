import { type NextRequest, NextResponse } from 'next/server';

import {
  API_URL,
  callApi,
  clearSession,
  COOKIE,
  errorBody,
  setTokens,
  type TokenPair,
} from '@/lib/server/session';

/** Request headers passed on to the API; everything else (cookies included) stays here. */
const FORWARDED = ['accept', 'content-type', 'idempotency-key', 'accept-language'];

/**
 * The browser's way to the API (#70): `/api/v1/...` is forwarded to
 * `${API_URL}/v1/...` with the access token from the httpOnly cookie. When
 * the access token has expired, it is refreshed once and the request
 * retried; if that fails, the session is cleared and the 401 passed on.
 */
async function forward(request: NextRequest, ctx: RouteContext<'/api/[...path]'>) {
  const { path } = await ctx.params;
  // Sign-in goes through /auth/*: the API's auth routes return tokens, which
  // must never reach page scripts.
  if (path[0] !== 'v1' || path[1] === 'auth' || path.some((p) => p === '.' || p === '..')) {
    return NextResponse.json(errorBody('NOT_FOUND', 'Not found'), { status: 404 });
  }
  if (request.cookies.get(COOKIE.mfa)?.value !== 'done') {
    return NextResponse.json(errorBody('UNAUTHENTICATED', 'Sign in first'), { status: 401 });
  }
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const url = `${API_URL}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const send = (token: string | undefined) => {
    const headers = new Headers();
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { method: request.method, headers, body, cache: 'no-store' });
  };

  let upstream = await send(request.cookies.get(COOKIE.access)?.value);
  let refreshed: TokenPair | null = null;
  const refreshToken = request.cookies.get(COOKIE.refresh)?.value;
  if (upstream.status === 401 && refreshToken) {
    const renewed = await callApi('/v1/auth/refresh', { method: 'POST', body: { refreshToken } });
    if (renewed.ok) {
      refreshed = (await renewed.json()) as TokenPair;
      upstream = await send(refreshed.accessToken);
    }
  }

  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'x-request-id']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
  if (upstream.status === 401) clearSession(response);
  else if (refreshed) setTokens(response, refreshed);
  return response;
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
