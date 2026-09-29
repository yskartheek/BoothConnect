import { type ApiClient, createApiClient } from '@boothconnect/api-client';

/** Where the API is: NEXT_PUBLIC_API_URL, or the local API in development. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The typed BoothConnect API client (#52): paths, parameters, bodies and
 * responses are checked against the OpenAPI spec at compile time.
 */
export function apiClient(
  getAccessToken?: () => string | null | undefined,
  fetch?: typeof globalThis.fetch,
): ApiClient {
  return createApiClient({ baseUrl: API_URL, getAccessToken, ...(fetch ? { fetch } : {}) });
}
