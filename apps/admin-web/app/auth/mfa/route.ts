import { type NextRequest, NextResponse } from 'next/server';

import { COOKIE, errorBody, mfaStubAllowed, setMfa } from '@/lib/server/session';

/**
 * The MFA step (placeholder): marks it done where the stub is allowed.
 * There is nothing to verify yet; the design is in the MFA page.
 */
export function POST(request: NextRequest): NextResponse {
  if (!request.cookies.get(COOKIE.refresh)?.value) {
    return NextResponse.json(errorBody('UNAUTHENTICATED', 'Sign in first'), { status: 401 });
  }
  if (!mfaStubAllowed()) {
    return NextResponse.json(
      errorBody('MFA_REQUIRED', 'Two-step verification is not available on this server'),
      { status: 403 },
    );
  }
  const response = NextResponse.json({ next: '/' });
  setMfa(response, 'done');
  return response;
}
