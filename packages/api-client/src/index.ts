import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch';

import type { components, operations, paths } from './schema';

/**
 * A typed client for the BoothConnect API (#52). The types are generated
 * from `docs/api/openapi.json` (`pnpm --filter @boothconnect/api-client
 * generate`); requests, query parameters, bodies and responses are all
 * checked by TypeScript.
 *
 * ```ts
 * const api = createApiClient({ baseUrl: 'http://localhost:4000', getAccessToken });
 * const { data, error } = await api.GET('/v1/households', { params: { query: { q: '16-64' } } });
 * ```
 */
export type { components, operations, paths };

/** Every schema in the spec, by name: `Schemas['HouseholdDetail']`. */
export type Schemas = components['schemas'];

/** The error body every endpoint uses: `{ requestId, code, message, details? }`. */
export type ApiError = Schemas['ApiErrorBody'];

export type ApiClient = Client<paths>;

export interface ApiClientOptions extends ClientOptions {
  /** The access token to send, if signed in; read before every request. */
  getAccessToken?: () => string | null | undefined;
}

export function createApiClient({ getAccessToken, ...options }: ApiClientOptions): ApiClient {
  const client = createClient<paths>(options);
  if (getAccessToken) {
    const auth: Middleware = {
      onRequest({ request }) {
        const token = getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      },
    };
    client.use(auth);
  }
  return client;
}

/** A fresh `Idempotency-Key` for a write (send the same one when retrying it). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
