import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@boothconnect/design-tokens/tokens.css';
import './globals.css';

import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: t('appTitle'),
  description: t('appDescription'),
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
