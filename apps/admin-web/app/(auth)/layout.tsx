import type { ReactNode } from 'react';

import { AppearanceMenu } from '@/components/appearance-menu';
import { t } from '@/lib/i18n';

/** Sign-in pages: a single panel, without the portal's navigation. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <header className="shell-top">
        <AppearanceMenu />
      </header>
      <main id="main" className="auth-main">
        <p className="shell-brand">{t('appTitle')}</p>
        <section className="glass" data-testid="glass-panel">
          {children}
        </section>
      </main>
    </div>
  );
}
