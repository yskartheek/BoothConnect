import { ApiRequestError } from './api';

/**
 * Calls this server's sign-in routes (`/auth/*`) from the page. The tokens
 * stay in httpOnly cookies; only the outcome comes back.
 */
export async function authPost<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, null);
  }
  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new ApiRequestError(response.status, data as never);
  return data as T | null;
}

/** A same-site path to go back to after sign-in; anything else becomes "/". */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/';
}
