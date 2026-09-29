import type { MessageKey } from '@/lib/i18n';
import { t } from '@/lib/i18n';

import { PageHeader } from './page-header';
import { EmptyState } from './states';

/** A Milestone 1 page whose screen hasn't been built yet. */
export function NotReadyPage({ title }: { title: MessageKey }) {
  return (
    <>
      <PageHeader title={t(title)} />
      <section className="glass">
        <EmptyState title={t('state.notReadyTitle')} message={t('state.notReadyMessage')} />
      </section>
    </>
  );
}
