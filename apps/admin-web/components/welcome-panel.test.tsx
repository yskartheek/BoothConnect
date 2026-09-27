import { render, screen } from '@testing-library/react';

import { WelcomePanel } from './welcome-panel';

describe('WelcomePanel', () => {
  it('renders the portal title as the page heading', () => {
    render(<WelcomePanel />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'BoothConnect Admin' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sign-in is not available yet/i)).toBeInTheDocument();
  });

  it('shows a custom message', () => {
    render(<WelcomePanel message="Maintenance until 18:00" />);
    expect(screen.getByText('Maintenance until 18:00')).toBeInTheDocument();
  });
});
