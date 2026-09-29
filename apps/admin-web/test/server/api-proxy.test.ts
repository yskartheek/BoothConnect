// @vitest-environment node
import { NextRequest } from 'next/server';

import { GET, POST } from '@/app/api/[...path]/route';

const API = 'http://localhost:4000';

/** A request to this server's /api with the given cookies. */
function request(
  path: string[],
  cookies: Record<string, string>,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) {
  const req = new NextRequest(`http://localhost:3000/api/${path.join('/')}`, init);
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return [req, { params: Promise.resolve({ path }) }] as const;
}
const signedIn = { bc_access: 'old-access', bc_refresh: 'refresh-1', bc_mfa: 'done' };

describe('/api proxy', () => {
  const upstream = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  beforeEach(() => {
    upstream.mockReset();
    vi.stubGlobal('fetch', upstream);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('forwards to the API with the token from the cookie', async () => {
    upstream.mockResolvedValue(Response.json({ id: 'u1' }, { headers: { 'x-request-id': 'r1' } }));
    const res = await GET(...request(['v1', 'me'], signedIn, { headers: { cookie: 'x=y' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'u1' });
    expect(res.headers.get('x-request-id')).toBe('r1');
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe(`${API}/v1/me`);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer old-access');
    // The browser's cookies never go to the API.
    expect(headers.get('cookie')).toBeNull();
  });

  it('passes a voter page image through as it is, not cacheable', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    upstream.mockResolvedValue(
      new Response(jpeg, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' },
      }),
    );
    const res = await GET(...request(['v1', 'imports', 'files', 'f1', 'pages', '3'], signedIn));
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpeg);
  });

  it('passes the query, the body and the idempotency key', async () => {
    upstream.mockResolvedValue(Response.json({}, { status: 201 }));
    const [req, ctx] = request(['v1', 'users'], signedIn, {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k-1' },
    });
    Object.defineProperty(req, 'nextUrl', {
      value: new URL('http://localhost:3000/api/v1/users?a=1'),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(201);
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe(`${API}/v1/users?a=1`);
    expect(new Headers(init.headers).get('idempotency-key')).toBe('k-1');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"name":"x"}');
  });

  it('refreshes an expired access token once and keeps the new tokens', async () => {
    upstream
      .mockResolvedValueOnce(Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ accessToken: 'new-access', refreshToken: 'refresh-2', expiresIn: 900 }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'u1' }));
    const res = await GET(...request(['v1', 'me'], signedIn));
    expect(res.status).toBe(200);
    expect(upstream.mock.calls[1]![0]).toBe(`${API}/v1/auth/refresh`);
    expect(JSON.parse(upstream.mock.calls[1]![1].body as string)).toEqual({
      refreshToken: 'refresh-1',
    });
    expect(new Headers(upstream.mock.calls[2]![1].headers).get('authorization')).toBe(
      'Bearer new-access',
    );
    expect(res.cookies.get('bc_access')).toMatchObject({ value: 'new-access', httpOnly: true });
    expect(res.cookies.get('bc_refresh')).toMatchObject({ value: 'refresh-2', httpOnly: true });
  });

  it('clears the session when the refresh fails too', async () => {
    upstream
      .mockResolvedValueOnce(Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 }));
    const res = await GET(...request(['v1', 'me'], signedIn));
    expect(res.status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(2);
    for (const name of ['bc_access', 'bc_refresh', 'bc_mfa']) {
      expect(res.cookies.get(name)?.value).toBe('');
    }
  });

  it('never exposes the API’s auth routes, other paths or dot segments', async () => {
    for (const path of [
      ['v1', 'auth', 'otp', 'verify'],
      ['v2', 'me'],
      ['v1', '..', 'x'],
    ]) {
      const res = await POST(...request(path, signedIn, { method: 'POST', body: '{}' }));
      expect(res.status).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('needs a finished sign-in, MFA step included', async () => {
    const res = await GET(...request(['v1', 'me'], { ...signedIn, bc_mfa: 'pending' }));
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
