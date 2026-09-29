/**
 * The signed-in admin's access token, for the API client. Sign-in (#70) sets
 * it; it lives in memory and in sessionStorage (so a reload keeps it, and
 * closing the tab ends it). When the API says the session has ended, it is
 * cleared and listeners are told, so the app can go back to sign-in.
 */
const KEY = 'bc.accessToken';
let token: string | null | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined; // blocked storage: memory only
  }
}

export function getAccessToken(): string | null {
  if (token === undefined) token = storage()?.getItem(KEY) ?? null;
  return token;
}

export function setAccessToken(value: string | null): void {
  token = value;
  const store = storage();
  if (value) store?.setItem(KEY, value);
  else store?.removeItem(KEY);
}

/** Called when the API rejects the session (401). */
export function endSession(): void {
  setAccessToken(null);
  for (const listener of listeners) listener();
}

/** Listens for the session ending; returns the unsubscribe function. */
export function onSessionEnded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
