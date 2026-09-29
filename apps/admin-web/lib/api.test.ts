import { ApiRequestError, apiClient, unwrap } from './api';
import { getAccessToken, onSessionEnded, setAccessToken } from './session';

const json = (body: unknown, status = 200) =>
  Promise.resolve(Response.json(body, { status, headers: { 'Content-Type': 'application/json' } }));

describe('api client', () => {
  afterEach(() => setAccessToken(null));

  it('calls the API with typed paths and the session token', async () => {
    const seen: Request[] = [];
    const fetch = (input: Request) => {
      seen.push(input);
      return json({ status: 'ok', checks: {} });
    };
    setAccessToken('token');
    const api = apiClient(undefined, fetch as typeof globalThis.fetch);
    const data = await unwrap(api.GET('/v1/health'));
    expect(data.status).toBe('ok');
    expect(seen[0]?.url).toBe('http://localhost:4000/v1/health');
    expect(seen[0]?.headers.get('Authorization')).toBe('Bearer token');
  });

  it('turns an error body into an ApiRequestError', async () => {
    const fetch = () =>
      json({ requestId: 'r-1', code: 'NOT_FOUND', message: 'Household not found' }, 404);
    const api = apiClient(() => 't', fetch as typeof globalThis.fetch);
    const error = await unwrap(api.GET('/v1/me')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'r-1' });
    expect((error as ApiRequestError).isClientError).toBe(true);
  });

  it('ends the session on 401', async () => {
    setAccessToken('expired');
    const ended = vi.fn();
    const stop = onSessionEnded(ended);
    const fetch = () => json({ requestId: 'r', code: 'UNAUTHENTICATED', message: 'x' }, 401);
    const api = apiClient(undefined, fetch as typeof globalThis.fetch);
    await expect(unwrap(api.GET('/v1/me'))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    stop();
  });

  it('reports a network failure as SERVICE_UNAVAILABLE', async () => {
    const fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const api = apiClient(() => null, fetch as typeof globalThis.fetch);
    await expect(unwrap(api.GET('/v1/health'))).rejects.toMatchObject({
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
      isClientError: false,
    });
  });
});
