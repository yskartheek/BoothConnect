import type { Metadata } from 'next';

import { NotReadyPage } from '@/components/not-ready-page';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.audit') };

export default function AuditPage() {
  return <NotReadyPage title="nav.audit" />;
}
