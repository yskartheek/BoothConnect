import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { BatchProgress, POLL_MS } from './batch-progress';
import type { Batch } from './import-wizard';

type BatchFile = Batch['files'][number];
const file = (
  name: string,
  status: BatchFile['status'],
  extra: Partial<BatchFile> = {},
): BatchFile => ({
  id: `f-${name}`,
  originalName: `${name}.pdf`,
  sizeBytes: 100,
  status,
  duplicateOfId: null,
  error: null,
  part: null,
  proposedPart: null,
  pageCount: null,
  rowCount: 0,
  rows: { accepted: 0, warning: 0, rejected: 0 },
  voterCount: 0,
  qualityScore: null,
  totalsMatch: null,
  extractedAt: null,
  confirmedAt: null,
  ...extra,
});
const extracted = (
  voters: number,
  totalsMatch: boolean | null,
  extra: Partial<BatchFile> = {},
) => ({
  pageCount: 30,
  rowCount: voters + 2,
  voterCount: voters,
  qualityScore: 0.914,
  totalsMatch,
  extractedAt: '2026-09-29T00:00:00.000Z',
  ...extra,
});
const batchOf = (files: BatchFile[]): Batch => {
  const statusCounts: Batch['statusCounts'] = {};
  for (const f of files) statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
  return {
    id: 'batch-1',
    targetNode: { id: 'ac101', type: 'ac', code: '40', name: 'Demo AC' },
    status: 'review',
    fileCount: files.length,
    statusCounts,
    files,
    createdAt: '2026-09-29T00:00:00.000Z',
  };
};

const FILES = [
  file('part-1', 'ready', {
    ...extracted(812, true),
    part: { id: 'p1', code: '1', name: 'Demo Nagar' },
  }),
  file('part-2', 'needs_review', {
    ...extracted(640, false),
    proposedPart: { code: '2', name: 'Sample Colony' },
  }),
  file('part-3', 'ready', { ...extracted(500, true), part: { id: 'p3', code: '3', name: 'Hill' } }),
  file('other-ac', 'rejected', {
    error: { code: 'header.outside_target', message: 'Part belongs to AC 41, not AC 40' },
  }),
  file('copy', 'duplicate', { duplicateOfId: 'f-part-1' }),
  file('part-9', 'extracting'),
];

function setUp(batches: Batch[], confirm?: [number, unknown]) {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      calls.push({ method: request.method, path });
      if (request.method === 'POST') {
        const [status, body] = confirm ?? [202, { queued: [], skipped: [] }];
        return Response.json(body, { status });
      }
      const gets = calls.filter((c) => c.method === 'GET').length;
      return Response.json(batches[Math.min(gets, batches.length) - 1]);
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BatchProgress batchId="batch-1" />
    </QueryClientProvider>,
  );
  return calls;
}
const rowOf = (name: string) =>
  screen.getByRole('row', { name: new RegExp(name.replace('.', '\\.')) });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BatchProgress', () => {
  it('shows each file’s part, status, pages, voters, quality and totals check', async () => {
    setUp([batchOf(FILES)]);
    await screen.findByRole('table', { name: 'Every file of this import' });
    expect(rowOf('part-1.pdf')).toHaveTextContent(
      /1 Demo Nagar.*Ready.*30.*812.*91%.*Totals match/,
    );
    const two = rowOf('part-2.pdf');
    expect(two).toHaveTextContent(/2 Sample Colony.*New.*Needs review.*640.*Totals don't match/);
    expect(within(two).getByText('✗')).toBeInTheDocument();
    expect(rowOf('copy.pdf')).toHaveTextContent('Already imported');
    // Not extracted yet: nothing to count.
    expect(rowOf('part-9.pdf')).toHaveTextContent(/Extracting.*—.*—.*—.*Not checked/);
    // Review opens a file that needs review or is ready.
    expect(within(two).getByRole('link', { name: 'Review part-2.pdf' })).toHaveAttribute(
      'href',
      '/imports?batch=batch-1&step=review&file=f-part-2',
    );
    expect(within(rowOf('copy.pdf')).queryByRole('link')).toBeNull();
    expect(within(rowOf('part-9.pdf')).queryByRole('link')).toBeNull();
  });

  it('shows why a file was rejected', async () => {
    setUp([batchOf(FILES)]);
    const rejected = await screen.findByRole('row', { name: /other-ac\.pdf/ });
    expect(rejected).toHaveTextContent(/Rejected.*Part belongs to AC 41, not AC 40/);
  });

  it('shows overall progress, and filters by status', async () => {
    setUp([batchOf(FILES)]);
    expect(await screen.findByLabelText('Files extracted: 5 of 6')).toHaveAttribute('value', '5');
    expect(screen.getByText('Still working. This page updates by itself.')).toBeInTheDocument();
    const filter = screen.getByLabelText('Show');
    expect(
      within(filter)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'All files (6)',
      'Extracting (1)',
      'Needs review (1)',
      'Ready (2)',
      'Rejected (1)',
      'Already imported (1)',
    ]);
    fireEvent.change(filter, { target: { value: 'ready' } });
    const table = screen.getByRole('table', { name: 'Every file of this import' });
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.firstChild?.textContent),
    ).toEqual(['part-1.pdf', 'part-3.pdf']);
  });

  it('"Confirm all" counts and confirms only the ready files', async () => {
    const calls = setUp(
      [batchOf(FILES)],
      [
        202,
        {
          queued: [{ id: 'f-part-1', status: 'confirming', voters: 812 }],
          skipped: [{ id: 'f-part-3', code: 'stale', message: 'The part changed since review' }],
        },
      ],
    );
    const button = await screen.findByRole('button', { name: 'Confirm all ready files (2)' });
    fireEvent.click(button);
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm the ready files?' });
    // 812 + 500: the needs-review file's 640 aren't counted.
    expect(dialog).toHaveTextContent(
      'Ready files: 2, with 1312 voters. Confirming makes those voters live.',
    );
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm all ready files (2)' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/v1/imports/batches/batch-1/confirm' },
    ]);
    const status = screen.getByText('Files being confirmed: 1.').closest('[role="status"]')!;
    expect(status).toHaveTextContent("part-3.pdf wasn't confirmed: The part changed since review");
  });

  it('offers no confirm when nothing is ready', async () => {
    setUp([batchOf([file('a', 'needs_review', extracted(10, false))])]);
    expect(
      await screen.findByRole('button', { name: 'Confirm all ready files (0)' }),
    ).toBeDisabled();
  });

  it('asks again every few seconds while files are working, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const done = FILES.map((f) =>
      f.status === 'extracting' ? { ...f, ...extracted(300, true), status: 'ready' as const } : f,
    );
    const calls = setUp([batchOf(FILES), batchOf(done)]);
    await screen.findByText('Still working. This page updates by itself.');
    // Asked again (however slow the first render was), and the page caught up.
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText('Every file has finished.')).toBeInTheDocument();
    expect(screen.getByLabelText('Files extracted: 6 of 6')).toBeInTheDocument();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // Nothing is working: no more requests.
    const asked = calls.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(calls).toHaveLength(asked);
  });

  it('shows 50 files at a time for large batches', async () => {
    const many = Array.from({ length: 120 }, (_, i) => file(`part-${i + 1}`, 'extracting'));
    setUp([batchOf(many)]);
    const table = await screen.findByRole('table', { name: 'Every file of this import' });
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    fireEvent.click(screen.getByRole('button', { name: 'Show 70 more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(within(table).getAllByRole('row')).toHaveLength(121);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });
});
