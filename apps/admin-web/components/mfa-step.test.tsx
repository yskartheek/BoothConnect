import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MfaStep } from './mfa-step';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('next=%2Faudit'),
}));

const respond = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );

describe('MfaStep', () => {
  beforeEach(() => replace.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('continues to where the admin was going', async () => {
    respond(200, { next: '/' });
    render(<MfaStep />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/audit'));
  });

  it('explains when the step is switched off on this server', async () => {
    respond(403, { code: 'MFA_REQUIRED', message: 'x', requestId: null });
    render(<MfaStep />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Two-step verification isn't available yet",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes back to sign-in without a session', async () => {
    respond(401, { code: 'UNAUTHENTICATED', message: 'x', requestId: null });
    render(<MfaStep />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
  });
});
