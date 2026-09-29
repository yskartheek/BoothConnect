import {
  type ApiClient,
  type ApiError,
  createApiClient,
  type Middleware,
} from '@boothconnect/api-client';

import { endSession, getAccessToken } from './session';

/** Where the API is: NEXT_PUBLIC_API_URL, or the local API in development. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** An error body as received; `code` may be one this client doesn't know yet. */
type ErrorBody = Partial<Omit<ApiError, 'code'>> & { code?: string };

/**
 * A failed API request: the API's error body (`{ requestId, code, message,
 * details? }`) and the HTTP status. Network failures have status 0 and code
 * `SERVICE_UNAVAILABLE`.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(status: number, body: ErrorBody | null | undefined) {
    super(body?.message ?? `Request failed (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
    this.requestId = body?.requestId ?? null;
    this.details = body?.details;
  }

  /** A mistake in the request (4xx): repeating it gives the same answer. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** Ends the session when the API says it has (401). */
const sessionGuard: Middleware = {
  onResponse({ response }) {
    if (response.status === 401) endSession();
    return response;
  },
};

/**
 * The typed BoothConnect API client (#52): paths, parameters, bodies and
 * responses are checked against the OpenAPI spec at compile time. By
 * default it sends the session's access token and ends the session on 401.
 */
export function apiClient(
  getToken: () => string | null | undefined = getAccessToken,
  fetch?: typeof globalThis.fetch,
): ApiClient {
  const client = createApiClient({
    baseUrl: API_URL,
    getAccessToken: getToken,
    ...(fetch ? { fetch } : {}),
  });
  client.use(sessionGuard);
  return client;
}

/**
 * The data of an openapi-fetch result, or an `ApiRequestError`:
 * `const household = await unwrap(api.GET('/v1/households/{id}', …))`.
 */
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: Awaited<typeof request>;
  try {
    result = await request;
  } catch {
    throw new ApiRequestError(0, null);
  }
  if (result.response.ok && result.error === undefined) return result.data as T;
  throw new ApiRequestError(result.response.status, result.error as ErrorBody);
}
