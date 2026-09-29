import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { MasterUpload } from './master-upload';

const CSV = 'level,code,name,parent_code\nstate,S98,Sample State,\n';
const report = (applied: boolean, action: 'create' | 'error' = 'create') => ({
  programId: 'p',
  applied,
  counts: {
    create: action === 'create' ? 1 : 0,
    update: 0,
    unchanged: 0,
    error: action === 'error' ? 1 : 0,
  },
  rows: [
    {
      line: 2,
      level: 'state',
      code: 'S98',
      name: 'Sample State',
      parentCode: null,
      action,
      errors: action === 'error' ? ['Outside your area'] : [],
    },
  ],
});

function setUp(...responses: [number, unknown][]) {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      bodies.push(await request.json());
      const [status, body] = responses.shift()!;
      return Response.json(body, { status });
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MasterUpload />
    </QueryClientProvider>,
  );
  const file = new File([CSV], 'master.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
  return bodies;
}

describe('MasterUpload', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('checks the file without saving, then saves it on confirm', async () => {
    const bodies = setUp([200, report(false)], [200, report(true)]);
    expect(
      await screen.findByText('1 to add, 0 to update, 0 unchanged, 0 with errors'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 changes' }));
    expect(await screen.findByText('Saved: 1 added, 0 updated.')).toBeInTheDocument();
    expect(bodies).toEqual([
      { csv: CSV, confirm: false },
      { csv: CSV, confirm: true },
    ]);
    expect(screen.queryByRole('button', { name: /Save \d+ changes/ })).not.toBeInTheDocument();
    // The picker is cleared, so a file (even the same one) can be checked again.
    expect((screen.getByLabelText('CSV file') as HTMLInputElement).files).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
  });

  it('offers no save while rows have errors, even with rows to add', async () => {
    const mixed = report(false, 'error');
    mixed.counts.create = 1;
    mixed.rows.push({ ...report(false).rows[0]!, line: 3 });
    setUp([200, mixed]);
    expect(await screen.findByText('Outside your area')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save \d+ changes/ })).not.toBeInTheDocument();
  });

  it('shows why a file can’t be used', async () => {
    setUp([
      422,
      { code: 'UNPROCESSABLE', message: 'Missing column(s): parent_code', requestId: 'r' },
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This file can't be used: Missing column(s): parent_code",
    );
  });

  it('offers the template to download', () => {
    setUp([200, report(false)]);
    expect(screen.getByRole('link', { name: 'Download the template CSV' })).toHaveAttribute(
      'href',
      '/templates/geography-master.csv',
    );
    return waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});
