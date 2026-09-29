import type { Metadata } from 'next';

import { UsersPage } from '@/components/users/users-page';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.users') };

/** Users and assignments (#176): the people of the admin's area and their roles. */
export default function Page() {
  return <UsersPage />;
}
