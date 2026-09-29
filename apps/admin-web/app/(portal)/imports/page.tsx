import type { Metadata } from 'next';

import { ImportWizard } from '@/components/imports/import-wizard';
import { PageHeader } from '@/components/page-header';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.imports') };

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

/** Roll imports (#71–#73): the batch and step are in the URL. */
export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const batch = one(params.batch);
  return (
    <>
      <PageHeader title={t('nav.imports')} />
      <ImportWizard key={batch ?? 'new'} batchId={batch} step={one(params.step)} />
    </>
  );
}
