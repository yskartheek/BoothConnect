'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { apiClient, unwrap } from '@/lib/api';
import { authPost } from '@/lib/auth-client';
import { t } from '@/lib/i18n';
import { onSessionEnded } from '@/lib/session';

/**
 * The signed-in admin's name and "Sign out", in the top bar. When the API
 * says the session has ended, it clears the cached data and goes back to
 * sign-in, returning here afterwards.
 */
export function SessionControls() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => unwrap(apiClient().GET('/v1/me')) });

  useEffect(
    () =>
      onSessionEnded(() => {
        queryClient.clear();
        const here = window.location.pathname + window.location.search;
        router.replace(here === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(here)}`);
      }),
    [queryClient, router],
  );

  const signOut = async () => {
    await authPost('/auth/sign-out').catch(() => undefined);
    queryClient.clear();
    router.replace('/sign-in');
  };

  return (
    <div className="session">
      {me.data ? <span className="session-name">{me.data.name}</span> : null}
      <button type="button" className="button button-quiet" onClick={() => void signOut()}>
        {t('signOut')}
      </button>
    </div>
  );
}
