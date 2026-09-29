import type { Schemas } from '@boothconnect/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { POLL_MS } from './batch-progress';
import { FileReview } from './file-review';
import { changedValues, isLowConfidence, type ReviewRow } from './review-rows';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

type Preview = Schemas['FilePreview'];

const values = (serial: number, extra: Record<string, unknown> = {}) => ({
  epic: `TST${1_000_000 + serial}`,
  name: `Synthetic Person ${serial}`,
  relationType: 'father',
  relativeName: `Synthetic Relative ${serial}`,
  houseNumber: `${serial}`,
  age: 30 + serial,
  gender: 'male',
  marker: null,
  sectionNumber: 1,
  ...extra,
});
const row = (serial: number, extra: Partial<ReviewRow> = {}): ReviewRow => ({
  id: `r${serial}`,
  page: 3,
  boxIndex: serial - 1,
  sectionNo: 1,
  serialNo: serial,
  status: 'accepted',
  messages: [],
  rawText: null,
  extracted: values(serial),
  confidence: { name: 0.95, age: 0.95 },
  corrected: null,
  current: values(serial),
  correctedBy: null,
  correctedAt: null,
  ...extra,
});
const ROWS = [
  row(1),
  row(2, {
    status: 'warning',
    confidence: { name: 0.4 },
    messages: [
      {
        code: 'field.low_confidence',
        severity: 'warning',
        message: 'name read with low confidence (0.40)',
        field: 'name',
      },
    ],
  }),
  row(3, {
    status: 'warning',
    extracted: values(3, { gender: null }),
    current: values(3, { gender: null }),
    messages: [
      { code: 'field.missing', severity: 'error', message: 'gender not found', field: 'gender' },
    ],
  }),
];
const counts = (male: number, female: number) => ({
  male,
  female,
  thirdGender: 0,
  total: male + female,
});
const preview = (extra: Partial<Preview> = {}, file: Partial<Preview['file']> = {}): Preview => ({
  file: {
    id: 'file-1',
    originalName: 'part-7.pdf',
    sizeBytes: 100,
    status: 'needs_review',
    duplicateOfId: null,
    error: null,
    part: null,
    proposedPart: { code: '7', name: 'Synthetic Town 7' },
    pageCount: 5,
    rowCount: 3,
    rows: { accepted: 1, warning: 2, rejected: 0 },
    voterCount: 3,
    qualityScore: 0.8,
    totalsMatch: false,
    extractedAt: '2026-09-29T00:00:00.000Z',
    confirmedAt: null,
    ...file,
  },
  header: {
    revisionType: 'Synthetic Revision 2027',
    revisionYear: 2027,
    acNumber: 101,
    partNumber: 7,
    sections: ['ignored'],
  },
  stations: [
    { code: '7', name: 'Synthetic School', auxiliary: false, nodeId: null },
    { code: '7A', name: 'Synthetic School annexe', auxiliary: true, nodeId: 'ps-7a' },
  ],
  previousSourceVersionId: null,
  issues: [{ code: 'totals.extracted_mismatch', severity: 'error', message: 'Totals differ' }],
  pages: [{ page: 3, width: 1984, height: 2807 }],
  totals: {
    printed: counts(2, 1),
    extracted: counts(1, 1),
    current: counts(1, 1),
    difference: { male: -1, female: 0, thirdGender: 0, total: -1 },
    matches: false,
  },
  willCommit: null,
  rows: { items: ROWS, nextCursor: null, total: 3 },
  ...extra,
});

type Reply = [number, unknown];
function setUp(route: (request: Request, url: URL) => Reply | undefined, first = preview()) {
  const calls: { method: string; url: URL; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const text = request.method === 'GET' ? '' : await request.text();
      calls.push({ method: request.method, url, ...(text ? { body: JSON.parse(text) } : {}) });
      const reply = route(request, url) ?? [200, first];
      return Response.json(reply[1], { status: reply[0] });
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <FileReview batchId="batch-1" fileId="file-1" />
    </QueryClientProvider>,
  );
  const previews = () => calls.filter((c) => c.url.pathname.endsWith('/preview'));
  return { calls, previews };
}
const errorBody = (code: string, message: string) => ({ code, message, requestId: 'req' });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe('changedValues', () => {
  const current = values(1);
  it('keeps only changed fields, trimmed and typed', () => {
    const form = Object.fromEntries(
      Object.entries(current).map(([k, v]) => [k, v === null ? '' : String(v)]),
    );
    expect(changedValues(current, form)).toEqual({});
    expect(
      changedValues(current, { ...form, name: '  New Name ', age: '44', sectionNumber: '2' }),
    ).toEqual({ name: 'New Name', age: 44, sectionNumber: 2 });
  });

  it('turns an emptied house number or marker into null, and ignores other emptied fields', () => {
    const withMarker = { ...current, marker: 'deleted' };
    expect(
      changedValues(withMarker, {
        houseNumber: '',
        marker: '',
        name: '',
        epic: current.epic,
      }),
    ).toEqual({ houseNumber: null, marker: null });
  });
});

describe('isLowConfidence', () => {
  it('is a field read below 0.6 and not corrected since', () => {
    expect(isLowConfidence(ROWS[1]!, 'name')).toBe(true);
    expect(isLowConfidence(ROWS[1]!, 'age')).toBe(false);
    expect(isLowConfidence({ ...ROWS[1]!, corrected: { name: 'Fixed' } }, 'name')).toBe(false);
    expect(isLowConfidence(row(9, { confidence: { name: 0.6 } }), 'name')).toBe(false);
  });
});

describe('FileReview', () => {
  it('shows what confirming creates, the cover page and the totals check by gender', async () => {
    setUp(() => undefined);
    const changes = await screen.findByText('What confirming does');
    const summary = changes.parentElement!;
    expect(summary).toHaveTextContent('Part 7 Synthetic Town 7 will be created.');
    expect(summary).toHaveTextContent('Polling station 7 Synthetic School will be created.');
    expect(summary).toHaveTextContent(
      'Polling station 7A Synthetic School annexe is already known.Auxiliary',
    );
    expect(summary).toHaveTextContent('RevisionSynthetic Revision 2027');
    expect(summary).not.toHaveTextContent('ignored');
    // Fields the roll didn't give aren't listed.
    expect(summary).not.toHaveTextContent('Qualifying date');
    expect(summary).not.toHaveTextContent('undefined');

    const totals = screen.getByRole('table', { name: /Totals check/ });
    expect(totals).toHaveAccessibleName("Totals check Totals don't match");
    const men = within(totals).getByRole('row', { name: /Men/ });
    expect(
      within(men)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['2', '1', '1', '-1']);
    expect(screen.getByText('Totals differ')).toHaveClass('form-error');
  });

  it('lists the rows, marking low-confidence fields and showing messages', async () => {
    setUp(() => undefined);
    const table = await screen.findByRole('table', { name: 'Rows read from the roll' });
    expect(screen.getByRole('heading', { name: 'Rows (3)' })).toBeInTheDocument();
    const second = within(table).getAllByRole('row')[2]!;
    const nameCell = within(second).getByText('Synthetic Person 2').closest('td')!;
    expect(nameCell).toHaveClass('low-confidence');
    expect(nameCell).toHaveTextContent('(low confidence)');
    expect(second).toHaveTextContent('Needs a look');
    expect(second).toHaveTextContent('name read with low confidence (0.40)');
    expect(within(table).getAllByRole('row')[1]!).toHaveTextContent(
      /1\/1.*TST1000001.*Synthetic Person 1.*Father.*Male.*Accepted/,
    );
  });

  it('filters by status and low confidence, pages with the cursor, and links the rejections CSV', async () => {
    const { previews } = setUp((_, url) =>
      url.pathname.endsWith('/preview') && !url.searchParams.has('cursor')
        ? [200, preview({ rows: { items: ROWS.slice(0, 2), nextCursor: 'c2', total: 3 } })]
        : undefined,
    );
    await screen.findByRole('table', { name: 'Rows read from the roll' });
    expect(previews()[0]!.url.searchParams.get('limit')).toBe('50');
    fireEvent.click(screen.getByRole('button', { name: 'Show more rows' }));
    await waitFor(() => expect(previews().at(-1)!.url.searchParams.get('cursor')).toBe('c2'));

    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: 'warning' } });
    await waitFor(() => expect(previews().at(-1)!.url.searchParams.get('status')).toBe('warning'));
    fireEvent.click(screen.getByLabelText('Only rows with low-confidence fields'));
    await waitFor(() =>
      expect(previews().at(-1)!.url.searchParams.get('lowConfidence')).toBe('true'),
    );
    expect(screen.getByRole('link', { name: 'Download rejections CSV' })).toHaveAttribute(
      'href',
      '/api/v1/imports/files/file-1/rejections.csv',
    );
  });

  it('corrects a row beside its page image, sending only the changed fields', async () => {
    const fixed = {
      ...ROWS[2]!,
      corrected: { gender: 'female' },
      current: values(3, { gender: 'female' }),
      correctedBy: { id: 'u-admin', name: 'Test Admin' },
      correctedAt: '2026-09-29T10:00:00.000Z',
    };
    let saved = false;
    const { calls } = setUp((request, url) => {
      if (request.method === 'PATCH') {
        saved = true;
        return [200, fixed];
      }
      // After the save, the refetched rows carry the correction.
      return saved && url.pathname.endsWith('/preview')
        ? [
            200,
            preview({ rows: { items: [ROWS[0]!, ROWS[1]!, fixed], nextCursor: null, total: 3 } }),
          ]
        : undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Correct row 1/3' }));
    const panel = screen.getByRole('region', { name: 'Row 1/3, page 3' });
    expect(within(panel).getByRole('img', { name: 'Page 3 of the roll' })).toHaveAttribute(
      'src',
      '/api/v1/imports/files/file-1/pages/3',
    );
    expect(within(panel).getByText('Box 3 on page 3')).toBeInTheDocument();
    const form = within(panel).getByRole('form', { name: 'Correct row 1/3' });
    // Each field shows the value as read.
    expect(within(form).getByLabelText('Gender')).toHaveAccessibleDescription('Read as: —');
    expect(within(form).getByRole('button', { name: 'Save correction' })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Gender'), { target: { value: 'female' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }));
    // The refetched row shows who corrected it, and the message stays.
    expect(await within(panel).findByText(/Corrected by Test Admin/)).toBeInTheDocument();
    expect(within(panel).getByRole('status')).toHaveTextContent('Correction saved.');
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url.pathname).toBe('/api/v1/imports/files/file-1/rows/r3');
    expect(patch.body).toEqual({ values: { gender: 'female' } });
  });

  it('rejects a row with a reason, and takes a rejection back', async () => {
    const { calls } = setUp((request) =>
      request.method === 'PATCH' ? [200, { ...ROWS[0], status: 'rejected' }] : undefined,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Correct row 1/1' }));
    const panel = screen.getByRole('region', { name: 'Row 1/1, page 3' });
    fireEvent.change(within(panel).getByLabelText('Reason (optional)'), {
      target: { value: ' Duplicate entry ' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject row' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      rejected: true,
      reason: 'Duplicate entry',
    });
  });

  it('offers to take back a rejection, and shows the API’s reason when a change is refused', async () => {
    const rejected = row(4, { status: 'rejected' });
    const { calls } = setUp(
      (request) =>
        request.method === 'PATCH'
          ? [409, errorBody('CONFLICT', 'This file is no longer in review')]
          : undefined,
      preview({ rows: { items: [rejected], nextCursor: null, total: 1 } }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Correct row 1/4' }));
    const panel = screen.getByRole('region', { name: 'Row 1/4, page 3' });
    expect(within(panel).queryByRole('button', { name: 'Save correction' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Take back the rejection' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'This file is no longer in review',
    );
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ rejected: false });
  });

  it('can’t confirm while rows have errors', async () => {
    setUp(() => undefined);
    expect(await screen.findByRole('button', { name: 'Confirm this file' })).toBeDisabled();
    expect(
      screen.getByText('Correct or reject the rows with errors before confirming.'),
    ).toBeInTheDocument();
  });

  it('confirms with the voters and households stated, acknowledging a totals mismatch', async () => {
    const ready = preview({ willCommit: { voters: 3, households: 2 } });
    const { calls } = setUp(
      (request) =>
        request.method === 'POST'
          ? [202, { id: 'file-1', status: 'confirming', voters: 3 }]
          : undefined,
      ready,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm this file' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm this file?' });
    expect(dialog).toHaveTextContent(
      'Voters to commit: 3, in 2 households, to Part 7 Synthetic Town 7.',
    );
    const go = within(dialog).getByRole('button', { name: 'Confirm this file' });
    // The totals don't match: the admin has to say they checked.
    expect(go).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText(/I've checked why/));
    fireEvent.click(go);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/imports?batch=batch-1&step=confirm&file=file-1'),
    );
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url.pathname).toBe('/api/v1/imports/files/file-1/confirm');
    expect(post.body).toEqual({ acceptTotalsMismatch: true });
  });

  it('sends no acknowledgement when the totals match, and shows a refusal as it is', async () => {
    const matching = preview({
      willCommit: { voters: 3, households: 3 },
      totals: { ...preview().totals, matches: true, difference: counts(0, 0) },
    });
    const { calls } = setUp(
      (request) =>
        request.method === 'POST'
          ? [422, errorBody('UNPROCESSABLE', 'The roll’s cover page is incomplete')]
          : undefined,
      matching,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm this file' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm this file' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The roll’s cover page is incomplete',
    );
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({});
    expect(replace).not.toHaveBeenCalled();
  });

  it('follows the commit, then links to the part’s analytics', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const confirming = preview({}, { status: 'confirming' });
    const confirmed = preview(
      {},
      {
        status: 'confirmed',
        part: { id: 'part-7', code: '7', name: 'Synthetic Town 7' },
        proposedPart: null,
      },
    );
    let asked = 0;
    setUp((_, url) => {
      if (!url.pathname.endsWith('/preview')) return undefined;
      asked += 1;
      return [200, asked === 1 ? confirming : confirmed];
    });
    expect(await screen.findByText('Committing the voters…')).toBeInTheDocument();
    // No corrections while it commits.
    expect(screen.queryByRole('button', { name: 'Confirm this file' })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText('Committed: 3 voters are live.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See the analytics of Part 7 Synthetic Town 7' }),
    ).toHaveAttribute('href', '/analytics?node=part-7');
    const after = asked;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(asked).toBe(after);
  });

  it('says when the file isn’t in the admin’s area', async () => {
    setUp(() => [404, errorBody('NOT_FOUND', 'x')]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This file can't be found in your area.",
    );
  });
});
