// @vitest-environment node
import { NextRequest } from 'next/server';

import { POST as mfa } from '@/app/auth/mfa/route';
import { POST as signOut } from '@/app/auth/sign-out/route';
import { POST as verify } from '@/app/auth/verify/route';

const post = (path: string, body: unknown, cookies: Record<string, string> = {}) => {
  const req = new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
};
const tokens = { accessToken: 'a-1', refreshToken: 'r-1', tokenType: 'Bearer', expiresIn: 900 };
const me = (role: string) => ({ id: 'u', name: 'X', assignments: [{ role }] });

describe('/auth routes', () => {
  const upstream = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  beforeEach(() => {
    upstream.mockReset();
    vi.stubGlobal('fetch', upstream);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('an admin gets the tokens as httpOnly cookies, and the MFA step next', async () => {
    upstream
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json(me('admin')));
    const res = await verify(post('/auth/verify', { phone: '+919999900001', code: '123456' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ next: '/sign-in/mfa' });
    // Only the outcome: the tokens are never in the body.
    expect(res.cookies.get('bc_access')).toMatchObject({
      value: 'a-1',
      httpOnly: true,
      maxAge: 900,
    });
    expect(res.cookies.get('bc_refresh')).toMatchObject({ value: 'r-1', httpOnly: true });
    expect(res.cookies.get('bc_mfa')?.value).toBe('pending');
    const device = res.cookies.get('bc_device')?.value;
    expect(device).toMatch(/^admin-web-/);
    const sent = JSON.parse(upstream.mock.calls[0]![1].body as string) as Record<string, string>;
    expect(sent).toEqual({ phone: '+919999900001', code: '123456', deviceId: device });
    expect(new Headers(upstream.mock.calls[1]![1].headers).get('authorization')).toBe('Bearer a-1');
  });

  it('reuses this browser’s device ID', async () => {
    upstream
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json(me('admin')));
    const res = await verify(
      post('/auth/verify', { phone: '+919999900001', code: '1' }, { bc_device: 'dev-1' }),
    );
    expect(JSON.parse(upstream.mock.calls[0]![1].body as string)).toMatchObject({
      deviceId: 'dev-1',
    });
    expect(res.cookies.get('bc_device')).toBeUndefined();
  });

  it('signs a non-admin out again at once, without cookies', async () => {
    upstream
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json(me('volunteer')))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await verify(post('/auth/verify', { phone: '+919999900002', code: '123456' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'NOT_ADMIN' });
    expect(upstream.mock.calls[2]![0]).toBe('http://localhost:4000/v1/auth/logout');
    expect(res.cookies.get('bc_access')?.value).toBe('');
    expect(res.cookies.get('bc_refresh')?.value).toBe('');
  });

  it('passes the API’s error for a wrong code', async () => {
    upstream.mockResolvedValueOnce(
      Response.json({ code: 'OTP_INVALID', message: 'x', requestId: 'r' }, { status: 401 }),
    );
    const res = await verify(post('/auth/verify', { phone: '+919999900001', code: '000000' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'OTP_INVALID' });
    expect(res.cookies.get('bc_access')).toBeUndefined();
  });

  it('the MFA stub lets an admin through in development only, unless allowed', () => {
    const signedIn = { bc_refresh: 'r-1', bc_mfa: 'pending' };
    vi.stubEnv('NODE_ENV', 'development');
    const dev = mfa(post('/auth/mfa', {}, signedIn));
    expect(dev.status).toBe(200);
    expect(dev.cookies.get('bc_mfa')?.value).toBe('done');

    vi.stubEnv('NODE_ENV', 'production');
    const prod = mfa(post('/auth/mfa', {}, signedIn));
    expect(prod.status).toBe(403);
    expect(prod.cookies.get('bc_mfa')).toBeUndefined();

    vi.stubEnv('ADMIN_MFA_STUB', 'allow');
    expect(mfa(post('/auth/mfa', {}, signedIn)).status).toBe(200);
    expect(mfa(post('/auth/mfa', {}, {})).status).toBe(401);
  });

  it('signing out ends the API session and clears the cookies', async () => {
    upstream.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await signOut(post('/auth/sign-out', {}, { bc_access: 'a-1', bc_mfa: 'done' }));
    expect(res.status).toBe(204);
    expect(upstream.mock.calls[0]![0]).toBe('http://localhost:4000/v1/auth/logout');
    expect(res.cookies.get('bc_mfa')?.value).toBe('');
  });
});
