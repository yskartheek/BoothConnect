import { AppearanceControls } from '@/components/appearance-controls';
import { WelcomePanel } from '@/components/welcome-panel';

export default function HomePage() {
  return (
    <main>
      <div className="glass" data-testid="glass-panel">
        <WelcomePanel />
      </div>
      <AppearanceControls />
    </main>
  );
}
