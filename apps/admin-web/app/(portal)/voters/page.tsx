import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { VoterRecord } from '@/components/voters/voter-record';
import { VoterSearch } from '@/components/voters/voter-search';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.voters') };

/** Voters and households (#75): find a voter, then `?voter=<id>` shows their record. */
export default async function VotersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { voter } = await searchParams;
  return (
    <>
      <PageHeader title={t('nav.voters')} />
      {typeof voter === 'string' ? <VoterRecord key={voter} voterId={voter} /> : <VoterSearch />}
    </>
  );
}
