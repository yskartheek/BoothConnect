import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { VoterRecord } from './voter-record';
import { VoterSearch } from './voter-search';

const value = (id: string, v: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  value: v,
  sourceType: 'volunteer_collected',
  collectedBy: { id: 'u-vol', name: 'Test Volunteer' },
  collectedAt: '2026-02-01T05:00:00.000Z',
  supersedesId: null,
  carriedFromId: null,
  conflictWithId: null,
  ...extra,
});
const field = (
  key: string,
  type: string,
  current: unknown[],
  extra: Record<string, unknown> = {},
) => ({
  key,
  labelKey: `field.${key}`,
  type,
  options: null,
  isRestricted: false,
  requiresConsent: false,
  current,
  history: [],
  ...extra,
});
const VOTER = {
  id: 'v1',
  householdId: 'h1',
  partId: 'p1',
  pollingStationId: 'ps1',
  origin: 'official_import',
  recordStatus: 'active',
  sectionNo: 1,
  serialNo: 7,
  epicNumber: 'TST1000007',
  official: {
    name: 'Synthetic Person 7',
    age: 34,
    gender: 'female',
    relationType: 'father',
    relativeName: 'Synthetic Relative 7',
    houseNumber: '5-1',
  },
  previousVoterIds: ['v0'],
  fields: [
    // Corrected once: the new name is current, the earlier one in history.
    field(
      'name',
      'text',
      [
        value('n2', 'Synthetic Person Seven', {
          supersedesId: 'n1',
          sourceType: 'admin_corrected',
          collectedBy: { id: 'u-admin', name: 'Test Admin' },
        }),
      ],
      {
        history: [value('n1', 'Synthetic Person 7x', { collectedAt: '2026-01-10T05:00:00.000Z' })],
      },
    ),
    field('age', 'number', []),
    field('gender', 'single_select', [], {
      options: [{ value: 'female' }, { value: 'male' }, { value: 'third_gender' }],
    }),
    // Two offline edits collided: both current.
    field('mobile_number', 'phone', [
      value('m1', '+919999900101', { conflictWithId: 'm2' }),
      value('m2', '+919999900102', {
        conflictWithId: 'm1',
        collectedBy: { id: 'u-vol2', name: 'Other Volunteer' },
      }),
    ]),
    field('occupation', 'text', [value('o1', 'Farmer', { carriedFromId: 'o0' })]),
    // Shared by the voter in the voter app (#224).
    field('additional_info', 'text', [
      value('a1', 'Synthetic note', {
        sourceType: 'voter_self_submitted',
        collectedBy: { id: 'u-voter', name: 'Synthetic Person 7' },
        collectedAt: '2026-10-02T05:00:00.000Z',
      }),
    ]),
    field('caste_community', 'text', [], { isRestricted: true, requiresConsent: true }),
  ],
  visitsMet: [
    {
      id: 'vis1',
      householdId: 'h1',
      volunteer: { id: 'u-vol', name: 'Test Volunteer' },
      startedAt: '2026-02-01T05:00:00.000Z',
      outcome: 'completed',
      correctedById: null,
    },
  ],
};

function setUp(route?: (request: Request, url: URL) => [number, unknown] | undefined) {
  const calls: { method: string; url: URL; body?: unknown; key: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const text = request.method === 'GET' ? '' : await request.text();
      calls.push({
        method: request.method,
        url,
        ...(text ? { body: JSON.parse(text) } : {}),
        key: request.headers.get('Idempotency-Key'),
      });
      const [status, body] = route?.(request, url) ?? [200, VOTER];
      return Response.json(body, { status });
    }),
  );
  return calls;
}
const renderRecord = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <VoterRecord voterId="v1" />
    </QueryClientProvider>,
  );
const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}`) });

afterEach(() => vi.unstubAllGlobals());

describe('VoterRecord', () => {
  it('shows one row per field: the official value from the roll and the current one, with who and when', async () => {
    const calls = setUp();
    renderRecord();
    expect(
      await screen.findByRole('heading', { name: 'Synthetic Person Seven' }),
    ).toBeInTheDocument();
    expect(calls[0]!.url.searchParams.get('history')).toBe('true');
    const table = screen.getByRole('table', {
      name: "Each field: the roll's value and the current one",
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Field', 'Official (from the roll)', 'Current', 'Actions']);
    expect(rowOf('Name')).toHaveTextContent(
      /Synthetic Person 7Synthetic Person Seven Admin · Test Admin · 1 Feb 2026/,
    );
    // Unchanged since the roll.
    expect(rowOf('Age')).toHaveTextContent('34As on the roll');
    expect(rowOf('Gender')).toHaveTextContent('FemaleAs on the roll');
    // Fields the roll doesn't print.
    expect(rowOf('Occupation')).toHaveTextContent(
      /Not on the rollFarmer Volunteer · Test Volunteer · 1 Feb 2026 \(carried over from the previous roll\)/,
    );
    expect(rowOf('Additional information')).toHaveTextContent(
      /Not on the rollSynthetic note Shared by the voter · Synthetic Person 7 · 2 Oct 2026/,
    );
    expect(rowOf('Caste/community')).toHaveTextContent(/RestrictedNot on the rollNot set/);
    // The roll's own details.
    expect(screen.getByText('TST1000007')).toBeInTheDocument();
    expect(screen.getByText('1/7')).toBeInTheDocument();
    expect(screen.getByText('1 from older rolls')).toBeInTheDocument();
    expect(screen.getByText(/Met the family/)).toBeInTheDocument();
  });

  it('expands a field’s history, newest first', async () => {
    setUp();
    renderRecord();
    const toggle = await screen.findByRole('button', {
      name: 'History of Name (1 earlier values)',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: /Earlier values of Name/ })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const history = screen.getByRole('list', { name: 'Earlier values of Name, newest first' });
    expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent(
      'Synthetic Person 7x Volunteer · Test Volunteer · 10 Jan 2026',
    );
    // Fields without history have no button.
    expect(screen.queryByRole('button', { name: /History of Age/ })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.queryByRole('list', { name: /Earlier values of Name/ })).toBeNull();
  });

  it('marks an open conflict clearly, with both values', async () => {
    setUp();
    renderRecord();
    expect(await screen.findByRole('alert')).toHaveTextContent('Open conflicts: Mobile number.');
    const mobile = rowOf('Mobile number');
    expect(mobile).toHaveClass('field-conflict');
    expect(within(mobile).getByText('Conflict: two values')).toBeInTheDocument();
    expect(mobile).toHaveTextContent('+919999900101');
    expect(mobile).toHaveTextContent('+919999900102');
    expect(mobile).toHaveTextContent('Other Volunteer');
    // Resolved by a volunteer, not overwritten here.
    expect(within(mobile).queryByRole('button', { name: /^Correct/ })).toBeNull();
    expect(within(rowOf('Name')).queryByText('Conflict: two values')).toBeNull();
  });

  it('lets an admin correct a value, based on the current one', async () => {
    const calls = setUp((request) =>
      request.method === 'PATCH'
        ? [
            200,
            {
              id: 'v1',
              fields: [
                {
                  fieldKey: 'name',
                  status: 'applied',
                  entityId: 'v1',
                  fieldValueId: 'n3',
                  supersedesId: 'n2',
                },
              ],
            },
          ]
        : undefined,
    );
    renderRecord();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Name' }));
    fireEvent.change(screen.getByLabelText('New value for Name'), {
      target: { value: ' Synthetic Person 7 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('New value for Name')).toBeNull());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url.pathname).toBe('/api/v1/voters/v1');
    expect(patch.body).toEqual({
      fields: [{ fieldKey: 'name', value: 'Synthetic Person 7', baseVersion: 'n2' }],
    });
    expect(patch.key).toMatch(/^[0-9a-f-]{36}$/);
    // Fetched again after the change.
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(1);
  });

  it('sends numbers as numbers and a field never set with no base; shows a refusal', async () => {
    const calls = setUp((request) =>
      request.method === 'PATCH'
        ? [
            200,
            {
              id: 'v1',
              fields: [
                {
                  fieldKey: 'age',
                  status: 'rejected',
                  code: 'invalid_value',
                  message: 'age must be between 18 and 120',
                },
              ],
            },
          ]
        : undefined,
    );
    renderRecord();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Age' }));
    fireEvent.change(screen.getByLabelText('New value for Age'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('age must be between 18 and 120')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      fields: [{ fieldKey: 'age', value: 12, baseVersion: null }],
    });
  });

  it('offers choices for a select field, and no correction of a consent-gated one', async () => {
    setUp();
    renderRecord();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Gender' }));
    expect(
      within(screen.getByLabelText('New value for Gender'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['—', 'Female', 'Male', 'Third gender']);
    expect(screen.queryByRole('button', { name: 'Correct Caste/community' })).toBeNull();
  });

  it('says when the voter isn’t in the admin’s area', async () => {
    setUp(() => [404, { code: 'NOT_FOUND', message: 'x', requestId: 'r' }]);
    renderRecord();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This voter can't be found in your area.",
    );
  });
});

describe('VoterSearch', () => {
  it('finds households, lists a household’s members, and links to their records', async () => {
    const calls = setUp((_, url) => {
      if (url.pathname === '/api/v1/households') {
        return [
          200,
          {
            items: [
              {
                id: 'h1',
                displayAddress: 'H NO 5-1',
                houseKey: '5-1',
                voterCount: 2,
                partId: 'p1',
                pollingStationId: 'ps1',
                origin: 'official_import',
                lastVisit: null,
              },
            ],
            nextCursor: null,
          },
        ];
      }
      if (url.pathname === '/api/v1/households/h1') {
        return [
          200,
          {
            id: 'h1',
            members: [
              {
                id: 'v1',
                origin: 'official_import',
                sectionNo: 1,
                serialNo: 7,
                epicNumber: 'TST1000007',
                name: 'Synthetic Person 7',
                age: 34,
                gender: 'female',
                relationType: 'father',
                relativeName: 'X',
                hasConflict: true,
              },
            ],
          },
        ];
      }
      return undefined;
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <VoterSearch />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: ' 5-1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    const household = await screen.findByRole('button', { name: 'H NO 5-1 · 2 members' });
    expect(calls[0]!.url.searchParams.get('q')).toBe('5-1');
    fireEvent.click(household);
    const link = await screen.findByRole('link', { name: 'Synthetic Person 7' });
    expect(link).toHaveAttribute('href', '/voters?voter=v1');
    expect(link.parentElement).toHaveTextContent('34 · Female · TST1000007');
    expect(link.parentElement).toHaveTextContent('Conflict: two values');
  });
});
