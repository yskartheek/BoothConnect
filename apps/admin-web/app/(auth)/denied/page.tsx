import type { Metadata } from 'next';
import Link from 'next/link';

import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('state.deniedTitle') };

/** Where someone without an admin role lands after signing in (#70). */
export default function DeniedPage() {
  return (
    <div className="state" role="alert">
      <h1>{t('state.deniedTitle')}</h1>
      <p>{t('denied.message')}</p>
      <Link href="/sign-in" className="button button-quiet">
        {t('denied.back')}
      </Link>
    </div>
  );
}
