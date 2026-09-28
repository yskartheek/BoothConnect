import { t } from '@/lib/i18n';

export interface WelcomePanelProps {
  /** Shown under the title; defaults to the pre-sign-in message. */
  message?: string;
}

export function WelcomePanel({ message = t('welcome.message') }: WelcomePanelProps) {
  return (
    <section aria-labelledby="welcome-title">
      <h1 id="welcome-title">{t('appTitle')}</h1>
      <p>{message}</p>
    </section>
  );
}
