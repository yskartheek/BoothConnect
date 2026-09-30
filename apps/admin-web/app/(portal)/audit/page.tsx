import type { Metadata } from 'next';

import { AuditExplorer } from '@/components/audit/audit-explorer';
import { type AuditFilters, FILTER_KEYS, filtersToSearch } from '@/components/audit/filters';
import { PageHeader } from '@/components/page-header';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.audit') };

/** Audit explorer (#76): the filters are in the address. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters: AuditFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === 'string' && value) filters[key] = value;
  }
  return (
    <>
      <PageHeader title={t('nav.audit')} />
      <AuditExplorer key={filtersToSearch(filters)} initial={filters} />
    </>
  );
}
