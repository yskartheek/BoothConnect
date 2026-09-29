'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ApiRequestError } from '@/lib/api';
import { authPost, safeNext } from '@/lib/auth-client';
import { t } from '@/lib/i18n';

import { errorMessage } from './states';

/**
 * The MFA step placeholder (#70). The real step (e.g. an authenticator app)
 * isn't built; the server lets admins through where the stub is allowed.
 */
export function MfaStep() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      await authPost('/auth/mfa');
      router.replace(next);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        router.replace('/sign-in');
        return;
      }
      setError(
        caught instanceof ApiRequestError && caught.code === 'MFA_REQUIRED'
          ? t('mfa.unavailable')
          : errorMessage(caught),
      );
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <p>{t('mfa.message')}</p>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <button type="button" className="button" disabled={busy} onClick={() => void proceed()}>
        {t('mfa.continue')}
      </button>
    </div>
  );
}
