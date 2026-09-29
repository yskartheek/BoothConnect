import { render, screen, within } from '@testing-library/react';

import { SideNav } from './side-nav';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('SideNav', () => {
  it('links the Milestone 1 pages and marks the current one', () => {
    pathname = '/users/123';
    render(<SideNav />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Overview',
      'Geography',
      'Voters and households',
      'Analytics',
      'Roll imports',
      'Users and assignments',
      'Audit and security',
    ]);
    expect(within(nav).getByRole('link', { name: 'Users and assignments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('shows later pages as disabled, not as links', () => {
    pathname = '/';
    render(<SideNav />);
    const later = screen.getByText('Campaigns').closest('[aria-disabled]');
    expect(later).toHaveAttribute('aria-disabled', 'true');
    expect(later).toHaveTextContent('Later');
    expect(screen.queryByRole('link', { name: /Campaigns/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
});
