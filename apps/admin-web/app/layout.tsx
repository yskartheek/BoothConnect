import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@boothconnect/design-tokens/tokens.css';
import './globals.css';

import { Providers } from '@/components/providers';
import { APPEARANCE_SCRIPT } from '@/lib/appearance';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: { default: t('appTitle'), template: `%s · ${t('appTitle')}` },
  description: t('appDescription'),
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline script sets data-theme/data-transparency before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
