import { NextResponse } from 'next/server';

import { callApi } from '@/lib/server/session';

/** Step 1 of sign-in: ask the API to send a code to the phone. */
export async function POST(request: Request): Promise<NextResponse> {
  const { phone } = (await request.json().catch(() => ({}))) as { phone?: unknown };
  const response = await callApi('/v1/auth/otp/request', { method: 'POST', body: { phone } });
  if (response.status === 202) return new NextResponse(null, { status: 202 });
  return NextResponse.json(await response.json().catch(() => null), { status: response.status });
}
