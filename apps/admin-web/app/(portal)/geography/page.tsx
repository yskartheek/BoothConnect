import type { Metadata } from 'next';

import { GeographyTree } from '@/components/geography/geography-tree';
import { MasterUpload } from '@/components/geography/master-upload';
import { PageHeader } from '@/components/page-header';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('nav.geography') };

/** Geography master data (#103): upload the State → PC → AC list and review the hierarchy. */
export default function GeographyPage() {
  return (
    <>
      <PageHeader title={t('nav.geography')} />
      <MasterUpload />
      <GeographyTree />
    </>
  );
}
