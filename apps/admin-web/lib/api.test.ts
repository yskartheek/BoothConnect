import { apiClient } from './api';

describe('api client', () => {
  it('calls the API with typed paths and returns typed data', async () => {
    const seen: Request[] = [];
    const fetch = (input: Request) => {
      seen.push(input);
      return Promise.resolve(
        Response.json(
          { status: 'ok', checks: {} },
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
    };
    const api = apiClient(() => 'token', fetch as typeof globalThis.fetch);
    const { data } = await api.GET('/v1/health');
    expect(data?.status).toBe('ok');
    expect(seen[0]?.url).toBe('http://localhost:4000/v1/health');
    expect(seen[0]?.headers.get('Authorization')).toBe('Bearer token');
  });
});
