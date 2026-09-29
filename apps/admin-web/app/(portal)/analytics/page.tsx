import type { Metadata } from 'next';

import { AnalyticsExplorer } from '@/components/analytics/analytics-explorer';
import { PageHeader } from '@/components/page-header';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.analytics') };

/** Analytics explorer (#74): any place of the admin's area, `?node=<id>`. */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { node } = await searchParams;
  return (
    <>
      <PageHeader title={t('nav.analytics')} />
      <AnalyticsExplorer nodeId={typeof node === 'string' ? node : undefined} />
    </>
  );
}
