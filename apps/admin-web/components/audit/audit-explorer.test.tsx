import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { AuditExplorer } from './audit-explorer';
import { apiQuery, type AuditFilters, filtersToSearch } from './filters';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

const event = (seq: number, extra: Record<string, unknown> = {}) => ({
  id: `e${seq}`,
  seq: String(seq),
  at: '2026-09-29T10:00:00.000Z',
  action: 'import.file.confirm',
  resourceType: 'import_file',
  resourceId: '01a0ed69-36bb-70ff-bffa-25926d392db0',
  result: 'success',
  actor: { id: 'u-admin', name: 'Test Admin' },
  sessionId: 's1',
  requestId: 'r1',
  metadata: { voters: 40, acceptTotalsMismatch: false },
  prevHash: 'aaa',
  hash: 'bbb',
  ...extra,
});

function setUp(initial: AuditFilters, route?: (url: URL) => [number, unknown] | undefined) {
  const urls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      urls.push(url);
      const custom = route?.(url);
      if (custom) return Response.json(custom[1], { status: custom[0] });
      if (url.pathname === '/api/v1/users') {
        return Response.json({
          items: [{ id: 'u-admin', name: 'Test Admin', assignments: [] }],
          nextCursor: null,
        });
      }
      return Response.json({
        items: [
          event(2),
          event(1, { action: 'auth.login', actor: null, result: 'failure', resourceId: null }),
        ],
        nextCursor: null,
      });
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuditExplorer initial={initial} />
    </QueryClientProvider>,
  );
  const events = () => urls.filter((u) => u.pathname === '/api/v1/audit-events');
  return { events };
}

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe('filters', () => {
  it('keeps only the filters that are set, in the address', () => {
    expect(filtersToSearch({})).toBe('');
    expect(filtersToSearch({ action: ' import.* ', actor: '', from: '2026-09-01' })).toBe(
      '?action=import.*&from=2026-09-01',
    );
  });

  it('sends "to" as the start of the next day (the API’s is exclusive)', () => {
    const q = apiQuery({ from: '2026-09-01', to: '2026-09-29', actor: 'u1', result: 'denied' });
    expect(q.from).toBe(new Date('2026-09-01T00:00:00').toISOString());
    expect(q.to).toBe(new Date('2026-09-30T00:00:00').toISOString());
    expect(q).toMatchObject({ actorId: 'u1', result: 'denied' });
    expect(apiQuery({})).toEqual({});
  });
});

describe('AuditExplorer', () => {
  it('lists events for the filters in the address, and applies new filters to the address', async () => {
    const { events } = setUp({ action: 'import.*', from: '2026-09-01' });
    const table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    const params = events()[0]!.searchParams;
    expect(params.get('action')).toBe('import.*');
    expect(params.get('from')).toBe(new Date('2026-09-01T00:00:00').toISOString());
    expect(params.get('limit')).toBe('50');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(
      /import\.file\.confirm.*Test Admin.*import_file · 01a0ed69….*Succeeded/,
    );
    expect(rows[2]).toHaveTextContent(/auth\.login.*System.*Failed/);

    expect(screen.getByLabelText('Action')).toHaveValue('import.*');
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'auth.*' } });
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'failure' } });
    await screen.findByRole('option', { name: 'Test Admin' });
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'u-admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(replace).toHaveBeenCalledWith(
      '/audit?actor=u-admin&action=auth.*&result=failure&from=2026-09-01',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(replace).toHaveBeenLastCalledWith('/audit');
  });

  it('opens an event with its redacted metadata and hashes', async () => {
    setUp({});
    fireEvent.click(
      await screen.findByRole('button', { name: 'Details of import.file.confirm (event 2)' }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'import.file.confirm' });
    expect(drawer).toHaveTextContent('Test Admin (u-admin)');
    expect(drawer).toHaveTextContent('01a0ed69-36bb-70ff-bffa-25926d392db0');
    expect(within(drawer).getByLabelText('Details recorded')).toHaveTextContent('"voters": 40');
    expect(drawer).toHaveTextContent('Ids, counts and codes only');
    fireEvent.click(within(drawer).getByText('Chain hashes'));
    expect(drawer).toHaveTextContent('bbb');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('verifies the chain over the date range, and says when it is broken', async () => {
    let intact = true;
    const { events } = setUp({ from: '2026-09-01', action: 'auth.*' }, (url) =>
      url.searchParams.get('verify') === 'true'
        ? [
            200,
            {
              items: [],
              nextCursor: null,
              verification: intact
                ? { checked: 120, intact: true, firstBrokenSeq: null }
                : { checked: 120, intact: false, firstBrokenSeq: '57' },
            },
          ]
        : undefined,
    );
    expect(screen.getByText(/Checks every event from 2026-09-01 to …/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    expect(
      await screen.findByText('The chain is intact: 120 events checked, none changed.'),
    ).toBeInTheDocument();
    const check = events().find((u) => u.searchParams.get('verify') === 'true')!;
    // The whole range, not just the filtered events.
    expect(check.searchParams.get('from')).toBe(new Date('2026-09-01T00:00:00').toISOString());
    expect(check.searchParams.has('action')).toBe(false);

    intact = false;
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The chain is broken at event 57 (120 events checked).',
    );
  });

  it('pages with the cursor, and explains a filter the API refuses', async () => {
    const { events } = setUp({}, (url) =>
      url.pathname === '/api/v1/audit-events' && !url.searchParams.has('cursor')
        ? [200, { items: [event(3)], nextCursor: 'c2' }]
        : undefined,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(events().at(-1)!.searchParams.get('cursor')).toBe('c2'));
    expect(await screen.findByText('auth.login')).toBeInTheDocument();
  });

  it('shows the API’s reason for a bad filter', async () => {
    setUp({ action: 'Bad Action' }, (url) =>
      url.pathname === '/api/v1/audit-events'
        ? [
            400,
            {
              code: 'VALIDATION_FAILED',
              message: 'Request validation failed',
              requestId: 'r',
              // The API puts the reasons per field in the details.
              details: [
                { field: 'action', errors: ['action must look like "auth.login" or "import.*"'] },
              ],
            },
          ]
        : undefined,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'These filters can\'t be used: action must look like "auth.login" or "import.*"',
    );
  });
});
