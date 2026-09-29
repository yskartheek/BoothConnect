import type { ReactNode } from 'react';

import { ApiRequestError } from '@/lib/api';
import { isMessageKey, t } from '@/lib/i18n';

/** Shown while something loads; announced politely to screen readers. */
export function LoadingState({ label = t('state.loading') }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite" aria-busy="true">
      <span className="state-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

/** Nothing to show yet, with an optional action (e.g. "Add a user"). */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
      {action}
    </div>
  );
}

/** The admin may not see this page or record (403). */
export function DeniedState({ message = t('error.FORBIDDEN') }: { message?: string }) {
  return (
    <div className="state" role="alert">
      <h2>{t('state.deniedTitle')}</h2>
      <p>{message}</p>
    </div>
  );
}

/** The message for an error code, e.g. `error.NOT_FOUND`; a generic one for unknown codes. */
export function errorMessage(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR';
  const key = `error.${code}`;
  return isMessageKey(key) ? t(key) : t('error.INTERNAL_ERROR');
}

/**
 * A request failed: the message for its code, the request ID to quote to
 * support, and "Try again" when `onRetry` is given. A 403 shows the denied
 * state instead.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiRequestError && error.status === 403) return <DeniedState />;
  const requestId = error instanceof ApiRequestError ? error.requestId : null;
  return (
    <div className="state" role="alert">
      <h2>{t('state.errorTitle')}</h2>
      <p>{errorMessage(error)}</p>
      {requestId ? <p className="state-reference">{t('state.reference', { requestId })}</p> : null}
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          {t('state.retry')}
        </button>
      ) : null}
    </div>
  );
}
