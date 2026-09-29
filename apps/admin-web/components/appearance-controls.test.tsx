import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AppearanceControls } from './appearance-controls';

describe('AppearanceControls', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.transparency;
    localStorage.clear();
  });

  it('follows the system theme by default', () => {
    render(<AppearanceControls />);
    expect(screen.getByLabelText('Theme')).toHaveValue('system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(document.documentElement).not.toHaveAttribute('data-transparency');
  });

  it('sets and clears data-theme on <html>', () => {
    render(<AppearanceControls />);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'system' } });
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('toggles data-transparency="reduced" on <html>', () => {
    render(<AppearanceControls />);
    const checkbox = screen.getByLabelText('Reduce transparency');
    fireEvent.click(checkbox);
    expect(document.documentElement).toHaveAttribute('data-transparency', 'reduced');
    fireEvent.click(checkbox);
    expect(document.documentElement).not.toHaveAttribute('data-transparency');
  });

  it('remembers the choice in this browser, and starts from it', () => {
    render(<AppearanceControls />);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } });
    fireEvent.click(screen.getByLabelText('Reduce transparency'));
    expect(localStorage.getItem('bc.theme')).toBe('light');
    expect(localStorage.getItem('bc.transparency')).toBe('reduced');
    cleanup();

    render(<AppearanceControls />);
    expect(screen.getByLabelText('Theme')).toHaveValue('light');
    expect(screen.getByLabelText('Reduce transparency')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'system' } });
    expect(localStorage.getItem('bc.theme')).toBeNull();
  });
});
