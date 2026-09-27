export interface WelcomePanelProps {
  /** Shown under the title; defaults to the pre-sign-in message. */
  message?: string;
}

export function WelcomePanel({
  message = 'Sign-in is not available yet. This is the admin portal skeleton.',
}: WelcomePanelProps) {
  return (
    <section aria-labelledby="welcome-title">
      <h1 id="welcome-title">BoothConnect Admin</h1>
      <p>{message}</p>
    </section>
  );
}
