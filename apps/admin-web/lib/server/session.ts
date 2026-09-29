import type { NextResponse } from 'next/server';

/**
 * Server-side only (route handlers and proxy.ts).
 *
 * The admin's sign-in, kept by the Next.js server (#70): the API's tokens
 * live in httpOnly cookies that page scripts can't read. The browser talks
 * to this server (`/auth/*`, `/api/*`), which adds the token when it calls
 * the API.
 */
export const COOKIE = {
  access: 'bc_access',
  refresh: 'bc_refresh',
  /** "pending" after the code, "done" after the MFA step. */
  mfa: 'bc_mfa',
  /** A random ID per browser, sent as the API's deviceId (one session per device). */
  device: 'bc_device',
} as const;

/** Where the API is, from the Next.js server. */
export const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

const base = () =>
  ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: '/',
  }) as const;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function setTokens(response: NextResponse, tokens: TokenPair): void {
  response.cookies.set(COOKIE.access, tokens.accessToken, { ...base(), maxAge: tokens.expiresIn });
  response.cookies.set(COOKIE.refresh, tokens.refreshToken, {
    ...base(),
    maxAge: REFRESH_MAX_AGE,
  });
}

export function setMfa(response: NextResponse, state: 'pending' | 'done'): void {
  response.cookies.set(COOKIE.mfa, state, { ...base(), maxAge: REFRESH_MAX_AGE });
}

export function setDevice(response: NextResponse, deviceId: string): void {
  response.cookies.set(COOKIE.device, deviceId, { ...base(), maxAge: 365 * 24 * 60 * 60 });
}

export function clearSession(response: NextResponse): void {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.mfa]) {
    response.cookies.set(name, '', { ...base(), maxAge: 0 });
  }
}

/**
 * The MFA step is only a placeholder (spec: designed, stubbed). It lets the
 * admin through in development, and in production only when
 * ADMIN_MFA_STUB=allow is set (e.g. a test deployment).
 */
export function mfaStubAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ADMIN_MFA_STUB === 'allow';
}

/** Calls the API from the server. */
export function callApi(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  return fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
}

/** An error body in the API's shape, for errors this server produces. */
export function errorBody(code: string, message: string) {
  return { requestId: null, code, message };
}
