import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SignInForm } from './sign-in-form';

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

const calls: { url: string; body: unknown }[] = [];
function answer(...responses: [number, unknown][]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
      const [status, body] = responses.shift() ?? [500, null];
      return Promise.resolve(
        body === null ? new Response(null, { status }) : Response.json(body, { status }),
      );
    }),
  );
}

async function enterPhoneAndCode(code = '123456') {
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: ' +919999900001 ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByText('If +919999900001 is registered, a 6-digit code is on its way.');
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInForm', () => {
  beforeEach(() => {
    replace.mockReset();
    calls.length = 0;
    search = '';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks for a code, then signs in and goes to the MFA step', async () => {
    search = 'next=%2Fusers';
    answer([202, null], [200, { next: '/sign-in/mfa' }]);
    render(<SignInForm />);
    await enterPhoneAndCode();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in/mfa?next=%2Fusers'));
    expect(calls).toEqual([
      { url: '/auth/request', body: { phone: '+919999900001' } },
      { url: '/auth/verify', body: { phone: '+919999900001', code: '123456' } },
    ]);
  });

  it('sends someone who is not an admin to the denied page', async () => {
    answer([202, null], [403, { code: 'NOT_ADMIN', message: 'x', requestId: null }]);
    render(<SignInForm />);
    await enterPhoneAndCode();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/denied'));
  });

  it('shows a wrong code as an error, and stays', async () => {
    answer([202, null], [401, { code: 'OTP_INVALID', message: 'x', requestId: 'r' }]);
    render(<SignInForm />);
    await enterPhoneAndCode('000000');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is wrong or has expired.',
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('ignores a "next" that leaves the site', async () => {
    search = 'next=https%3A%2F%2Fevil.example';
    answer([202, null], [200, { next: '/sign-in/mfa' }]);
    render(<SignInForm />);
    await enterPhoneAndCode();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in/mfa'));
  });

  it('only enables the buttons when there is something to send', async () => {
    answer([202, null]);
    render(<SignInForm devHint />);
    expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+919999900001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '12a3' } });
    expect(screen.getByLabelText('Code')).toHaveValue('123');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(
      screen.getByText("Development: the code is printed in the API's log."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use another number' }));
    expect(screen.getByLabelText('Phone number')).toHaveValue('+919999900001');
  });
});
