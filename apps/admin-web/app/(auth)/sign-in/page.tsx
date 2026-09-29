import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignInForm } from '@/components/sign-in-form';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('signIn.title') };

export default function SignInPage() {
  return (
    <>
      <h1>{t('signIn.title')}</h1>
      <p>{t('signIn.intro')}</p>
      <Suspense>
        <SignInForm devHint={process.env.NODE_ENV !== 'production'} />
      </Suspense>
    </>
  );
}
