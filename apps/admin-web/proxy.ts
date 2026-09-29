import { type NextRequest, NextResponse } from 'next/server';

import { COOKIE } from '@/lib/server/session';

/**
 * Keeps the portal's pages behind sign-in (#70): without a session, go to
 * /sign-in (and come back afterwards); after the code but before the MFA
 * step, go to /sign-in/mfa. An optimistic check only: the API checks the
 * token and the admin role on every request.
 */
export function proxy(request: NextRequest) {
  const signedIn = !!request.cookies.get(COOKIE.refresh)?.value;
  if (!signedIn) {
    const url = new URL('/sign-in', request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== '/') url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }
  if (request.cookies.get(COOKIE.mfa)?.value !== 'done') {
    return NextResponse.redirect(new URL('/sign-in/mfa', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Every page except sign-in, the denied page, the /auth and /api routes,
  // and Next.js's own files.
  matcher: ['/((?!sign-in|denied|auth/|api/|_next/|favicon.ico).*)'],
};
