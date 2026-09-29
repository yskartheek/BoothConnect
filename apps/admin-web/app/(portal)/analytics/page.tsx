import type { Metadata } from 'next';

import { NotReadyPage } from '@/components/not-ready-page';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.analytics') };

export default function AnalyticsPage() {
  return <NotReadyPage title="nav.analytics" />;
}
