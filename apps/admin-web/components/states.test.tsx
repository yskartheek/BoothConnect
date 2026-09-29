import { fireEvent, render, screen } from '@testing-library/react';

import { ApiRequestError } from '@/lib/api';

import { DeniedState, EmptyState, ErrorState, errorMessage, LoadingState } from './states';

const apiError = (status: number, code: string, requestId = 'req-123') =>
  new ApiRequestError(status, { code, message: 'server text', requestId });

describe('ErrorState', () => {
  it('shows the message for the error code and the request ID', () => {
    render(<ErrorState error={apiError(404, 'NOT_FOUND')} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent("This couldn't be found. It may have been removed.");
    expect(alert).toHaveTextContent('Reference: req-123');
    // Never the server's own wording, which isn't translated.
    expect(alert).not.toHaveTextContent('server text');
  });

  it('offers "Try again" when it can retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState error={apiError(500, 'INTERNAL_ERROR')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no retry button or reference when there is nothing to show', () => {
    render(<ErrorState error={new Error('boom')} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('Reference');
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('shows the denied state for a 403', () => {
    render(<ErrorState error={apiError(403, 'FORBIDDEN')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No access');
    expect(screen.getByRole('alert')).toHaveTextContent(
      "You don't have permission to see or change this.",
    );
  });

  it('maps unknown codes and network failures to readable messages', () => {
    expect(errorMessage(apiError(418, 'SOMETHING_NEW'))).toBe('Something went wrong. Try again.');
    expect(errorMessage(new ApiRequestError(0, null))).toBe(
      "The server isn't available. Your work is saved on the phone.",
    );
  });
});

describe('LoadingState, EmptyState and DeniedState', () => {
  it('announces loading politely', () => {
    render(<LoadingState />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading…');
  });

  it('shows a title, a message and an action', () => {
    render(<EmptyState title="No users" message="Add one" action={<button>Add</button>} />);
    expect(screen.getByRole('heading', { name: 'No users' })).toBeInTheDocument();
    expect(screen.getByText('Add one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('explains a denied page', () => {
    render(<DeniedState />);
    expect(screen.getByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });
});
