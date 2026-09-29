import type { ReactNode } from 'react';

import { AppearanceMenu } from '@/components/appearance-menu';
import { SideNav } from '@/components/side-nav';
import { t } from '@/lib/i18n';

/** The portal's frame: side navigation, top bar and the page. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        {t('skipToContent')}
      </a>
      <div className="shell">
        <aside className="shell-nav glass" data-testid="glass-panel">
          <p className="shell-brand">{t('appTitle')}</p>
          <SideNav />
        </aside>
        <div className="shell-body">
          <header className="shell-top">
            <AppearanceMenu />
          </header>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
