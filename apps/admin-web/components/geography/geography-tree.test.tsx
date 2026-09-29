import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { EditPlace, filterTree, type MasterNode } from './geography-tree';

const node = (type: MasterNode['type'], code: string, name: string, children: MasterNode[] = []) =>
  ({
    id: `${type}-${code}`,
    parentId: null,
    type,
    code,
    name,
    isAuxiliary: false,
    reservation: null,
    children,
  }) as MasterNode;

describe('filterTree', () => {
  const tree = [
    node('state', 'S99', 'Demo State', [
      node('pc', '1', 'Demo PC', [node('ac', '101', 'Demo AC'), node('ac', '102', 'Hill AC')]),
      node('pc', '2', 'Other PC', [node('ac', '201', 'River AC')]),
    ]),
  ];
  const codes = (nodes: MasterNode[]): string[] =>
    nodes.flatMap((n) => [n.code, ...codes(n.children)]);

  it('keeps matches and the path down to them', () => {
    expect(codes(filterTree(tree, 'river'))).toEqual(['S99', '2', '201']);
    expect(codes(filterTree(tree, '10'))).toEqual(['S99', '1', '101', '102']);
  });

  it('matches the start of a code, and any part of a name, ignoring case', () => {
    expect(codes(filterTree(tree, '01'))).toEqual([]);
    expect(codes(filterTree(tree, 'HILL'))).toEqual(['S99', '1', '102']);
  });

  it('keeps a matching node whole, and everything when the search is empty', () => {
    expect(codes(filterTree(tree, 'demo pc'))).toEqual(['S99', '1', '101', '102']);
    expect(filterTree(tree, '  ')).toBe(tree);
  });
});

describe('EditPlace', () => {
  const place = { ...node('ac', '101', 'Demo AC'), reservation: 'GEN' };
  const renderEdit = (onDone = vi.fn()) => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <EditPlace place={place} onDone={onDone} />
      </QueryClientProvider>,
    );
    return onDone;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('saves the name and reservation (empty removes it), with an idempotency key', async () => {
    const seen: Request[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) => {
        seen.push(request);
        return Promise.resolve(Response.json({ ...place, name: 'Renamed' }));
      }),
    );
    const onDone = renderEdit();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Renamed ' } });
    fireEvent.change(screen.getByLabelText('Reservation'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(seen[0]!.method).toBe('PATCH');
    expect(seen[0]!.url).toMatch(/\/api\/v1\/geographies\/ac-101$/);
    expect(seen[0]!.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await seen[0]!.json()).toEqual({ name: 'Renamed', reservation: null });
  });

  it('sends only what changed, and nothing when nothing did', async () => {
    const seen: Request[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request) => {
        seen.push(request);
        return Promise.resolve(Response.json(place));
      }),
    );
    const onDone = renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Reservation'), { target: { value: 'SC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    expect(await seen[0]!.json()).toEqual({ reservation: 'SC' });
  });

  it('explains a place outside the admin’s area', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({ code: 'NOT_FOUND', message: 'x', requestId: 'r' }, { status: 404 }),
        ),
      ),
    );
    const onDone = renderEdit();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can only change places in your own area.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});
