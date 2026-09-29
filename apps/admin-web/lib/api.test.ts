import { ApiRequestError, apiClient, unwrap } from './api';
import { onSessionEnded } from './session';

const json = (body: unknown, status = 200) =>
  Promise.resolve(Response.json(body, { status, headers: { 'Content-Type': 'application/json' } }));
const BASE = 'http://localhost:3000/api';

describe('api client', () => {
  it('calls this server’s /api with typed paths, and never sends a token itself', async () => {
    const seen: Request[] = [];
    const fetch = (input: Request) => {
      seen.push(input);
      return json({ status: 'ok', checks: {} });
    };
    const api = apiClient({ baseUrl: BASE, fetch: fetch as typeof globalThis.fetch });
    const data = await unwrap(api.GET('/v1/health'));
    expect(data.status).toBe('ok');
    expect(seen[0]?.url).toBe('http://localhost:3000/api/v1/health');
    // The token is in an httpOnly cookie; the server adds it.
    expect(seen[0]?.headers.get('Authorization')).toBeNull();
    expect(seen[0]?.credentials).toBe('same-origin');
  });

  it('uses the page’s own origin by default', async () => {
    const seen: Request[] = [];
    const fetch = (input: Request) => {
      seen.push(input);
      return json({ status: 'ok', checks: {} });
    };
    await unwrap(apiClient({ fetch: fetch as typeof globalThis.fetch }).GET('/v1/health'));
    expect(seen[0]?.url).toBe(`${window.location.origin}/api/v1/health`);
  });

  it('turns an error body into an ApiRequestError', async () => {
    const fetch = () =>
      json({ requestId: 'r-1', code: 'NOT_FOUND', message: 'Household not found' }, 404);
    const api = apiClient({ baseUrl: BASE, fetch: fetch as typeof globalThis.fetch });
    const error = await unwrap(api.GET('/v1/me')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'r-1' });
    expect((error as ApiRequestError).isClientError).toBe(true);
  });

  it('ends the session on 401', async () => {
    const ended = vi.fn();
    const stop = onSessionEnded(ended);
    const fetch = () => json({ requestId: 'r', code: 'UNAUTHENTICATED', message: 'x' }, 401);
    const api = apiClient({ baseUrl: BASE, fetch: fetch as typeof globalThis.fetch });
    await expect(unwrap(api.GET('/v1/me'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(ended).toHaveBeenCalledTimes(1);
    stop();
    await unwrap(api.GET('/v1/me')).catch(() => undefined);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure as SERVICE_UNAVAILABLE', async () => {
    const fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const api = apiClient({ baseUrl: BASE, fetch: fetch as typeof globalThis.fetch });
    await expect(unwrap(api.GET('/v1/health'))).rejects.toMatchObject({
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
      isClientError: false,
    });
  });
});
