import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { AreaPicker, type AreaNode, PlaceBreadcrumb } from './area-picker';
import { createQueryClient } from './providers';

const node = (type: string, id: string, code: string, name: string, parentId: string | null) => ({
  id,
  type,
  code,
  name,
  parentId,
  isAuxiliary: false,
  reservation: null,
});
const STATE = node('state', 's99', 'S99', 'Demo State', null);
const CHILDREN: Record<string, ReturnType<typeof node>[]> = {
  s99: [node('pc', 'pc1', '1', 'Demo PC', 's99')],
  pc1: [node('ac', 'ac101', '101', 'Demo AC', 'pc1'), node('ac', 'ac102', '102', 'Hill AC', 'pc1')],
  // An AC has hundreds of parts: a search box.
  ac101: Array.from({ length: 12 }, (_, i) =>
    node('part', `p${i + 1}`, String(i + 1), i === 6 ? 'Temple Street' : `Ward ${i + 1}`, 'ac101'),
  ),
  ac102: [node('part', 'q1', '1', 'Hill Top', 'ac102')],
  p1: [node('polling_station', 'ps1', '1', 'School', 'p1')],
};

function setUp(deepest?: 'part') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/me') {
        return Response.json({
          id: 'u-admin',
          name: 'State Admin',
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
              node: { ...STATE, isAuxiliary: false },
              path: [{ id: 's99', type: 'state', code: 'S99', name: 'Demo State' }],
            },
          ],
        });
      }
      const items = CHILDREN[url.searchParams.get('parentId') ?? ''] ?? [];
      return Response.json({ items, nextCursor: null });
    }),
  );
  const changes: AreaNode[][] = [];
  function Harness() {
    const [path, setPath] = useState<AreaNode[]>([]);
    return (
      <>
        <AreaPicker
          legend="Place"
          path={path}
          emptyLabel="Choose…"
          deepest={deepest}
          onChange={(next) => {
            changes.push(next);
            setPath(next);
          }}
        />
        <PlaceBreadcrumb path={path} label="Chosen place" />
      </>
    );
  }
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
  return { last: () => changes.at(-1)!.map((n) => n.id) };
}
const pick = async (label: string, id: string) => {
  const select = await screen.findByLabelText(label);
  if (id) await waitFor(() => expect(select.querySelector(`option[value="${id}"]`)).not.toBeNull());
  fireEvent.change(select, { target: { value: id } });
};
const optionsOf = (label: string) =>
  within(screen.getByLabelText(label))
    .getAllByRole('option')
    .map((o) => o.textContent);

afterEach(() => vi.unstubAllGlobals());

describe('AreaPicker', () => {
  it('cascades State → PC → AC → Part, and changing the AC resets the part', async () => {
    const { last } = setUp('part');
    await screen.findByRole('option', { name: 'State S99 Demo State' });
    await pick('Your area', 's99');
    await pick('PC', 'pc1');
    await pick('AC', 'ac101');
    await pick('Part', 'p7');
    expect(last()).toEqual(['s99', 'pc1', 'ac101', 'p7']);
    const crumbs = within(screen.getByRole('navigation', { name: 'Chosen place' }));
    expect(crumbs.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'State S99 Demo State',
      'PC 1 Demo PC',
      'AC 101 Demo AC',
      'Part 7 Temple Street',
    ]);

    // Stops at Part: no station dropdown, even for a part with stations.
    await pick('Part', 'p1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByLabelText('Polling station')).toBeNull();

    await pick('AC', 'ac102');
    expect(last()).toEqual(['s99', 'pc1', 'ac102']);
    await waitFor(() => expect(optionsOf('Part')).toEqual(['Choose…', '1 Hill Top']));
    expect(screen.getByLabelText('Part')).toHaveValue('');

    // Back to "Choose…" at the PC: the AC and the part go.
    await pick('PC', '');
    expect(last()).toEqual(['s99']);
    expect(screen.queryByLabelText('AC')).toBeNull();
  });

  it('offers a search box on long lists, keeping the chosen option', async () => {
    setUp('part');
    await pick('Your area', 's99');
    await pick('PC', 'pc1');
    await pick('AC', 'ac101');
    await screen.findByLabelText('Part');
    // Two ACs: no search box. Twelve parts: one.
    expect(screen.queryByLabelText('Search AC')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search Part'), { target: { value: 'temple' } });
    expect(optionsOf('Part')).toEqual(['Choose…', '7 Temple Street']);
    fireEvent.change(screen.getByLabelText('Search Part'), { target: { value: '1' } });
    expect(optionsOf('Part')).toEqual([
      'Choose…',
      '1 Ward 1',
      '10 Ward 10',
      '11 Ward 11',
      '12 Ward 12',
    ]);
    await pick('Part', 'p10');
    fireEvent.change(screen.getByLabelText('Search Part'), { target: { value: 'temple' } });
    expect(optionsOf('Part')).toEqual(['Choose…', '7 Temple Street', '10 Ward 10']);
    expect(screen.getByLabelText('Part')).toHaveValue('p10');
  });

  it('goes down to polling stations by default', async () => {
    setUp();
    await pick('Your area', 's99');
    await pick('PC', 'pc1');
    await pick('AC', 'ac101');
    await pick('Part', 'p1');
    expect(await screen.findByLabelText('Polling station')).toBeInTheDocument();
  });
});
