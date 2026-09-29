import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { AnalyticsExplorer } from './analytics-explorer';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const STATE = { id: 's99', type: 'state', code: 'S99', name: 'Demo State' };
const PC = { id: 'pc1', type: 'pc', code: '1', name: 'Demo PC' };
const AC = { id: 'ac101', type: 'ac', code: '101', name: 'Demo AC' };
const place = (node: typeof AC, parentId: string | null, path: (typeof AC)[]) => ({
  ...node,
  parentId,
  isAuxiliary: false,
  reservation: null,
  path: path.map((p) => ({ ...p, parentId: null, isAuxiliary: false, reservation: null })),
});
const part = (code: string) => ({ id: `p${code}`, type: 'part', code, name: `Ward ${code}` });

const figures = (extra: Record<string, number | 'suppressed' | null> = {}) => ({
  'electors.total': 1200,
  'electors.male': 600,
  'electors.female': 580,
  'electors.thirdGender': 'suppressed',
  'electors.unknown': 'suppressed',
  genderRatio: 967,
  medianAge: 41.5,
  'ages.18-19': 45,
  'households.total': 400,
  votersPerHousehold: 3,
  'revisions.net': 0,
  extractionQuality: 0.92,
  'fieldWork.householdsVisited': null,
  visitedShare: null,
  ...extra,
});
const summary = (node: typeof AC, extra = {}) => ({
  node,
  minCohort: 10,
  definitions: {
    'electors.total': 'Active voters on the roll.',
    genderRatio: 'Women per 1,000 men.',
  },
  computedAt: '2026-09-29T10:00:00.000Z',
  metrics: figures(extra),
});
const children = {
  node: AC,
  minCohort: 10,
  definitions: {},
  computedAt: '2026-09-29T10:00:00.000Z',
  total: figures(),
  average: figures({ 'electors.total': 400, genderRatio: 967 }),
  children: [
    {
      node: part('2'),
      computedAt: null,
      metrics: figures({ 'electors.total': 600, genderRatio: 900 }),
    },
    { node: part('1'), computedAt: null, metrics: figures({ 'electors.total': 'suppressed' }) },
    { node: part('10'), computedAt: null, metrics: figures({ 'electors.total': 390 }) },
  ],
};
const ME = {
  id: 'u',
  name: 'Admin',
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
      path: [STATE, PC, AC],
    },
  ],
};

function setUp(
  nodeId: string | undefined,
  route?: (path: string) => [number, unknown] | undefined,
) {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      const custom = route?.(path);
      if (custom) return Response.json(custom[1], { status: custom[0] });
      if (path === '/api/v1/me') return Response.json(ME);
      if (path === '/api/v1/geographies/ac101') return Response.json(place(AC, 'pc1', [STATE, PC]));
      if (path === '/api/v1/analytics/nodes/ac101/summary') return Response.json(summary(AC));
      if (path === '/api/v1/analytics/nodes/ac101/children') return Response.json(children);
      if (path === '/api/v1/analytics/nodes/pc1/summary') {
        return Response.json(summary(PC, { genderRatio: 981 }));
      }
      if (path === '/api/v1/geographies') return Response.json({ items: [], nextCursor: null });
      return Response.json({ code: 'NOT_FOUND', message: 'x', requestId: 'r' }, { status: 404 });
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AnalyticsExplorer nodeId={nodeId} />
    </QueryClientProvider>,
  );
  return paths;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe('AnalyticsExplorer', () => {
  it('opens the admin’s own area without a node in the address', async () => {
    const paths = setUp(undefined);
    expect(await screen.findByRole('heading', { name: 'AC 101 Demo AC' })).toBeInTheDocument();
    expect(paths).toContain('/api/v1/analytics/nodes/ac101/summary');
  });

  it('shows the figures with definitions; suppressed as "<10", not collected as such, never 0', async () => {
    setUp('ac101');
    const electors = await screen.findByRole('article', { name: 'Electors' });
    const total = within(electors).getByText('1,200');
    expect(total).toHaveAccessibleDescription('Active voters on the roll.');
    const third = within(electors).getByText('Third gender', { selector: 'dt' }).parentElement!;
    expect(third).toHaveTextContent('<10');
    expect(third).not.toHaveTextContent(/\b0\b/);
    expect(within(third).getByText('<10')).toHaveAccessibleDescription(
      /Fewer than 10 people, or could be worked out/,
    );
    const field = screen.getByRole('article', { name: 'Field work' });
    expect(
      within(field).getByText('Households visited', { selector: 'dt' }).parentElement,
    ).toHaveTextContent('Not collected');
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    // The chart: no bar for a suppressed category, only its label.
    const chart = within(electors).getByRole('figure', { name: 'Chart: Electors' });
    const thirdBar = within(chart).getByTitle('Third gender: <10');
    expect(thirdBar.querySelector('.bar-fill')).toBeNull();
    expect(within(chart).getByTitle('Men: 600').querySelector('.bar-fill')).not.toBeNull();
  });

  it('compares the node with its parent, and links the breadcrumbs in the admin’s area', async () => {
    setUp('ac101');
    const comparison = await screen.findByRole('table', { name: 'Compared with PC 1 Demo PC' });
    expect(within(comparison).getByRole('row', { name: /Gender ratio/ })).toHaveTextContent(
      'Gender ratio967981',
    );
    const crumbs = screen.getByRole('navigation', { name: 'Where you are' });
    expect(
      within(crumbs)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['State S99 Demo State', 'PC 1 Demo PC', 'AC 101 Demo AC']);
    // Above the admin's AC: not theirs to open.
    expect(within(crumbs).queryAllByRole('link')).toHaveLength(0);
  });

  it('lists the children with total and average, sortable, marking figures far from the average', async () => {
    setUp('ac101');
    const table = await screen.findByRole('table', {
      name: 'Figures for each place below, with the total and the average',
    });
    const names = () =>
      within(table)
        .getAllByRole('row')
        .slice(1, 4)
        .map((row) => row.querySelector('th')!.textContent);
    expect(names()).toEqual(['1 Ward 1', '2 Ward 2', '10 Ward 10']);

    fireEvent.click(within(table).getByRole('button', { name: /^Electors/ }));
    expect(names()).toEqual(['2 Ward 2', '10 Ward 10', '1 Ward 1']);
    expect(within(table).getByRole('columnheader', { name: /^Electors/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    fireEvent.click(within(table).getByRole('button', { name: /^Electors/ }));
    // Suppressed stays last either way.
    expect(names()).toEqual(['10 Ward 10', '2 Ward 2', '1 Ward 1']);
    expect(within(table).getByRole('columnheader', { name: /^Electors/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    // 600 vs an average of 400: far from it; 390 isn't.
    const ward2 = within(table).getByRole('row', { name: /Ward 2/ });
    expect(within(ward2).getByText('600').closest('td')).toHaveClass('far-from-average');
    expect(within(ward2).getByText('600').closest('td')).toHaveTextContent(
      '(far from the average)',
    );
    const ward10 = within(table).getByRole('row', { name: /Ward 10/ });
    expect(within(ward10).getByText('390').closest('td')).not.toHaveClass('far-from-average');
    expect(within(table).getByRole('row', { name: /^Total/ })).toHaveTextContent('1,200');
    expect(within(table).getByRole('row', { name: /^Average/ })).toHaveTextContent('400');

    // Drill down.
    expect(within(table).getByRole('link', { name: '2 Ward 2' })).toHaveAttribute(
      'href',
      '/analytics?node=p2',
    );
  });

  it('says so for a place outside the admin’s area', async () => {
    setUp('elsewhere');
    expect(await screen.findByText("This place isn't in your area.")).toBeInTheDocument();
  });

  it('shows no comparison when the parent is outside the area', async () => {
    setUp('ac101', (path) =>
      path === '/api/v1/analytics/nodes/pc1/summary'
        ? [404, { code: 'NOT_FOUND', message: 'x', requestId: 'r' }]
        : undefined,
    );
    await screen.findByRole('article', { name: 'Electors' });
    expect(screen.queryByRole('table', { name: /Compared with/ })).toBeNull();
  });
});
