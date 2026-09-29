/**
 * The signed-in admin's session lives in httpOnly cookies on the Next.js
 * server (#70); page scripts never see a token. What the page does know is
 * when the API says the session has ended (a 401 through `/api`): listeners
 * are told, so the app can go back to sign-in.
 */
const listeners = new Set<() => void>();

/** Called when the API rejects the session (401). */
export function endSession(): void {
  for (const listener of listeners) listener();
}

/** Listens for the session ending; returns the unsubscribe function. */
export function onSessionEnded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
