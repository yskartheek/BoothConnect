import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { PutPart } from '@/lib/upload';

import { createQueryClient } from '../providers';
import { ChooseLevel, type Batch, Stepper } from './import-wizard';
import { UploadFiles } from './upload-files';

const AC = { id: 'ac101', type: 'ac', code: '101', name: 'Demo AC' } as const;
const PART = { id: 'p1', type: 'part', code: '1', name: 'Demo Nagar' } as const;
const batchAt = (target: typeof AC | typeof PART, files: Batch['files'] = []): Batch => ({
  id: 'batch-1',
  targetNode: target,
  status: 'uploading',
  fileCount: files.length,
  statusCounts: {},
  files,
  createdAt: '2026-09-29T00:00:00.000Z',
});
const fileView = (name: string, status: Batch['files'][number]['status']) =>
  ({ id: `f-${name}`, originalName: name, sizeBytes: 10, status }) as Batch['files'][number];

const pdf = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' });
const ticket = (id: string, name: string, size: number) => ({
  id,
  kind: 'pdf',
  originalName: name,
  sizeBytes: size,
  partSizeBytes: 16 * 1024 * 1024,
  parts: [{ partNumber: 1, url: `https://storage.test/${id}/1` }],
  expiresAt: '2999-01-01T00:00:00.000Z',
});
const completed = (id: string, name: string, status: string, skipped: unknown[] = []) => ({
  uploadId: id,
  files: [{ id: `file-${id}`, originalName: name, sizeBytes: 10, status, duplicateOfId: null }],
  skipped,
});

type Reply = [number, unknown];

function setUp(
  batch: Batch,
  route: (method: string, path: string, body: unknown) => Reply,
  put: PutPart,
) {
  const calls: { method: string; path: string; body: unknown; key: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      const text = request.method === 'GET' ? '' : await request.text();
      const body = text ? JSON.parse(text) : undefined;
      calls.push({
        method: request.method,
        path,
        body,
        key: request.headers.get('Idempotency-Key'),
      });
      const [status, reply] = route(request.method, path, body);
      return Response.json(reply, { status });
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <UploadFiles batch={batch} put={put} />
    </QueryClientProvider>,
  );
  return calls;
}
const choose = (label: RegExp, files: File[]) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files } });

afterEach(() => vi.unstubAllGlobals());

describe('UploadFiles', () => {
  it('gets upload links, sends the parts, completes each file, and shows duplicates as already imported', async () => {
    const puts: string[] = [];
    const calls = setUp(
      batchAt(AC),
      (method, path, body) => {
        if (path === '/api/v1/imports/batches/batch-1/files') {
          const files = (body as { files: { name: string; sizeBytes: number }[] }).files;
          return [
            201,
            { uploads: files.map((f, i) => ticket(`up-${i + 1}`, f.name, f.sizeBytes)) },
          ];
        }
        if (path.endsWith('/up-1/complete'))
          return [200, completed('up-1', 'part-1.pdf', 'extracting')];
        if (path.endsWith('/up-2/complete'))
          return [200, completed('up-2', 'part-2.pdf', 'duplicate')];
        return [404, {}];
      },
      async (url) => {
        puts.push(url);
        return `"etag-${url.split('/').at(-2)}"`;
      },
    );
    choose(/Choose PDF or ZIP files/, [pdf('part-1.pdf'), pdf('part-2.pdf', 20)]);
    fireEvent.click(screen.getByRole('button', { name: 'Upload files (2)' }));

    const list = screen.getByRole('list', { name: 'Files to upload' });
    await waitFor(() => expect(within(list).getAllByText('Uploaded')).toHaveLength(2));
    const [start] = calls.filter((c) => c.path.endsWith('/files'));
    expect(start!.body).toEqual({
      files: [
        { name: 'part-1.pdf', sizeBytes: 10, contentType: 'application/pdf' },
        { name: 'part-2.pdf', sizeBytes: 20, contentType: 'application/pdf' },
      ],
    });
    expect(start!.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(puts.sort()).toEqual(['https://storage.test/up-1/1', 'https://storage.test/up-2/1']);
    const complete = calls.find((c) => c.path.endsWith('/up-1/complete'))!;
    expect(complete.body).toEqual({ parts: [{ partNumber: 1, etag: '"etag-up-1"' }] });

    // The duplicate is "Already imported", not an error.
    const second = within(list).getByText('part-2.pdf', { selector: 'strong' }).closest('li')!;
    expect(within(second).getByText('Already imported')).toHaveClass('badge-info');
    expect(within(second).queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Next: extraction' })).toHaveAttribute(
      'href',
      '/imports?batch=batch-1&step=extract',
    );
  });

  it('lists skipped ZIP entries, and the batch’s earlier files with their status', async () => {
    setUp(
      batchAt(AC, [fileView('old.pdf', 'duplicate'), fileView('other.pdf', 'extracting')]),
      (method, path) =>
        path.endsWith('/files')
          ? [201, { uploads: [ticket('up-1', 'rolls.zip', 10)] }]
          : [
              200,
              completed('up-1', 'part-9.pdf', 'extracting', [
                { name: 'notes.txt', reason: 'not a PDF' },
              ]),
            ],
      async () => '"e"',
    );
    const table = screen.getByRole('table', { name: 'Files in this import' });
    expect(within(table).getByRole('row', { name: /old.pdf/ })).toHaveTextContent(
      'Already imported',
    );
    expect(within(table).getByRole('row', { name: /other.pdf/ })).toHaveTextContent('Extracting');

    choose(/Choose PDF or ZIP files/, [new File(['zip'], 'rolls.zip')]);
    fireEvent.click(screen.getByRole('button', { name: 'Upload files (1)' }));
    expect(await screen.findByText('Skipped notes.txt: not a PDF')).toBeInTheDocument();
    expect(screen.getByText('part-9.pdf')).toBeInTheDocument();
  });

  it('refuses files the level doesn’t take, and a second PDF at Part level', async () => {
    setUp(
      batchAt(PART),
      () => [404, {}],
      async () => '"e"',
    );
    const input = screen.getByLabelText(/Choose a PDF/);
    expect(input).not.toHaveAttribute('multiple');
    choose(/Choose a PDF/, [pdf('a.pdf'), pdf('b.pdf'), new File(['z'], 'c.zip')]);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('b.pdf: a Part takes exactly one PDF');
    expect(alert).toHaveTextContent('c.zip: only a PDF can be uploaded at Part level');
    expect(screen.getByRole('button', { name: 'Upload files (1)' })).toBeInTheDocument();
  });

  it('shows why the API refused a file, and Retry continues from the parts already sent', async () => {
    let fail = true;
    const puts: string[] = [];
    const twoParts = {
      ...ticket('up-1', 'big.pdf', 20),
      partSizeBytes: 10,
      parts: [
        { partNumber: 1, url: 'https://storage.test/up-1/1' },
        { partNumber: 2, url: 'https://storage.test/up-1/2' },
      ],
    };
    const calls = setUp(
      batchAt(AC),
      (method, path) =>
        path.endsWith('/files')
          ? [201, { uploads: [twoParts] }]
          : [200, completed('up-1', 'big.pdf', 'extracting')],
      async (url) => {
        puts.push(url);
        if (url.endsWith('/2') && fail) throw new Error('Network error');
        return '"e"';
      },
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      choose(/Choose PDF or ZIP files/, [pdf('big.pdf', 20)]);
      fireEvent.click(screen.getByRole('button', { name: 'Upload files (1)' }));
      // Retries wait 1, 2, 4 and 8 s before giving up.
      await vi.advanceTimersByTimeAsync(16_000);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The upload stopped. Check the connection, then Retry',
      );
    } finally {
      vi.useRealTimers();
    }
    expect(puts.filter((u) => u.endsWith('/1'))).toHaveLength(1);
    expect(puts.filter((u) => u.endsWith('/2'))).toHaveLength(5);

    fail = false;
    puts.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Retry big.pdf' }));
    await screen.findByText('Uploaded');
    expect(puts).toEqual(['https://storage.test/up-1/2']);
    // The same upload: no new links.
    expect(calls.filter((c) => c.path.endsWith('/files'))).toHaveLength(1);
  });

  it('shows the API’s reason when it won’t take a file, and Retry starts it again', async () => {
    let tickets = 0;
    setUp(
      batchAt(AC),
      (method, path) => {
        if (path.endsWith('/files')) {
          tickets += 1;
          return [201, { uploads: [ticket(`up-${tickets}`, 'fake.pdf', 10)] }];
        }
        return tickets === 1
          ? [422, { code: 'UNPROCESSABLE', message: 'The file is not a PDF', requestId: 'r' }]
          : [200, completed('up-2', 'fake.pdf', 'extracting')];
      },
      async () => '"e"',
    );
    choose(/Choose PDF or ZIP files/, [pdf('fake.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Upload files (1)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is not a PDF');
    fireEvent.click(screen.getByRole('button', { name: 'Retry fake.pdf' }));
    await screen.findByText('Uploaded');
    expect(tickets).toBe(2);
  });
});

describe('ChooseLevel and Stepper', () => {
  it('opens a batch at the chosen place', async () => {
    const seen: { path: string; body: unknown; key: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/v1/me') {
          return Response.json({
            id: 'u',
            name: 'A',
            phone: '+91…',
            email: null,
            preferredLanguage: 'en',
            mfaState: 'not_enrolled',
            assignments: [
              {
                id: 'ra',
                role: 'admin',
                validFrom: '2026-01-01T00:00:00.000Z',
                validUntil: null,
                node: { ...AC, isAuxiliary: false },
                path: [
                  { id: 's99', type: 'state', code: 'S99', name: 'Demo State' },
                  { id: 'pc1', type: 'pc', code: '1', name: 'Demo PC' },
                  AC,
                ],
              },
            ],
          });
        }
        if (url.pathname === '/api/v1/geographies') {
          return Response.json({
            items: [{ ...PART, parentId: AC.id, isAuxiliary: false, reservation: null }],
            nextCursor: null,
          });
        }
        seen.push({
          path: url.pathname,
          body: await request.json(),
          key: request.headers.get('Idempotency-Key'),
        });
        return Response.json(
          { id: 'batch-9', targetNode: PART, status: 'uploading', fileCount: 0 },
          { status: 201 },
        );
      }),
    );
    const onCreated = vi.fn();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ChooseLevel onCreated={onCreated} />
      </QueryClientProvider>,
    );
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    const area = await screen.findByLabelText('Your area');
    await waitFor(() => expect(area.querySelector('option[value="ac101"]')).not.toBeNull());
    fireEvent.change(area, { target: { value: AC.id } });
    expect(screen.getByText(/Upload one PDF per part/)).toBeInTheDocument();
    const part = await screen.findByLabelText('Part');
    await waitFor(() => expect(part.querySelector('option[value="p1"]')).not.toBeNull());
    fireEvent.change(part, { target: { value: PART.id } });
    expect(screen.getByText(/upload exactly one PDF/)).toBeInTheDocument();
    // The breadcrumb starts at the State above the admin's AC.
    expect(screen.getByRole('navigation', { name: 'Chosen place' })).toHaveTextContent(
      /State S99 Demo State.*PC 1 Demo PC.*AC 101 Demo AC.*Part 1 Demo Nagar/,
    );
    fireEvent.click(next);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('batch-9'));
    expect(seen[0]).toMatchObject({
      path: '/api/v1/imports/batches',
      body: { targetNodeId: 'p1' },
    });
    expect(seen[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('marks the current step', () => {
    render(<Stepper current="upload" />);
    const steps = within(screen.getByRole('list', { name: 'Import steps' })).getAllByRole(
      'listitem',
    );
    expect(steps.map((s) => s.textContent)).toEqual([
      '1Choose level',
      '2Upload',
      '3Extract',
      '4Review',
      '5Confirm',
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveClass('stepper-done');
  });
});
