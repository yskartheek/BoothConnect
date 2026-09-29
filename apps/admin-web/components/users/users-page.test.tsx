import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createQueryClient } from '../providers';
import { UsersPage } from './users-page';

const AC = { id: 'ac-101', type: 'ac', code: '101', name: 'Demo AC' } as const;
const PART = { id: 'part-1', type: 'part', code: '1', name: 'Demo Nagar' } as const;
const PART2 = { id: 'part-2', type: 'part', code: '2', name: 'Hill Nagar' } as const;
const BOOTH = { id: 'ps-1', type: 'polling_station', code: '1', name: 'Demo School' } as const;
const place = (
  node: { id: string; type: string; code: string; name: string },
  parentId: string,
) => ({
  ...node,
  parentId,
  isAuxiliary: false,
  reservation: null,
});

const assignment = (
  id: string,
  userId: string,
  role: string,
  node: { id: string; type: string; code: string; name: string },
  extra: Record<string, unknown> = {},
) => ({
  id,
  userId,
  role,
  node,
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: null,
  active: true,
  grantedBy: { id: 'u-admin', name: 'Test Admin' },
  ...extra,
});
const user = (id: string, name: string, assignments: unknown[]) => ({
  id,
  name,
  phone: '+919999900010',
  status: 'active',
  preferredLanguage: 'en',
  assignments,
});
const ADMIN = user('u-admin', 'Test Admin', [
  assignment('ra-admin', 'u-admin', 'admin', AC, { grantedBy: null }),
]);
const VOLUNTEER = user('u-vol', 'Asha Volunteer', [
  assignment('ra-vol', 'u-vol', 'volunteer', BOOTH),
  assignment('ra-old', 'u-vol', 'campaign_manager', PART, {
    active: false,
    validUntil: '2026-02-01T00:00:00.000Z',
  }),
]);
const ME = {
  id: 'u-admin',
  name: 'Test Admin',
  phone: '+91…',
  email: null,
  preferredLanguage: 'en',
  mfaState: 'not_enrolled',
  assignments: [
    {
      id: 'ra-admin',
      role: 'admin',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: null,
      node: { ...AC, isAuxiliary: false },
      path: [],
    },
  ],
};

type Reply = [number, unknown];
type Handler = (request: Request) => Reply | undefined;

/** A fake API: the first handler that answers wins; every request is kept. */
function setUp(...handlers: Handler[]) {
  const requests: Request[] = [];
  const bodies: unknown[] = [];
  const base: Handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/me') return [200, ME];
    if (url.pathname === '/api/v1/geographies') {
      const parentId = url.searchParams.get('parentId');
      if (parentId === AC.id)
        return [200, { items: [place(PART, AC.id), place(PART2, AC.id)], nextCursor: null }];
      if (parentId === PART.id) return [200, { items: [place(BOOTH, PART.id)], nextCursor: null }];
      return [200, { items: [], nextCursor: null }];
    }
    if (url.pathname === '/api/v1/users' && request.method === 'GET') {
      return [200, { items: [ADMIN, VOLUNTEER], nextCursor: null }];
    }
    if (url.pathname === '/api/v1/users/u-vol') return [200, VOLUNTEER];
    if (url.pathname === '/api/v1/users/u-admin') return [200, ADMIN];
    return undefined;
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requests.push(request);
      bodies.push(request.method === 'GET' ? undefined : await request.clone().text());
      for (const handler of [...handlers, base]) {
        const reply = handler(request);
        if (reply) {
          const [status, body] = reply;
          return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
        }
      }
      return Response.json({ code: 'NOT_FOUND', message: 'x', requestId: 'r' }, { status: 404 });
    }),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <UsersPage />
    </QueryClientProvider>,
  );
  const sent = (method: string, path: string) =>
    requests
      .map((request, i) => ({ request, body: bodies[i] as string | undefined }))
      .filter(({ request }) => request.method === method && new URL(request.url).pathname === path);
  const lastList = () => {
    const lists = sent('GET', '/api/v1/users');
    return new URL(lists.at(-1)!.request.url).searchParams;
  };
  return { sent, lastList };
}
const errorBody = (code: string, message: string) => ({ code, message, requestId: 'req-1' });
const table = async (name: RegExp) => screen.findByRole('table', { name });

afterEach(() => vi.unstubAllGlobals());

describe('UsersPage list', () => {
  it('shows the users of the area with their active roles, active only by default', async () => {
    const { lastList } = setUp();
    const list = await table(/Users in your area/);
    const row = within(list).getByRole('row', { name: /Asha Volunteer/ });
    expect(row).toHaveTextContent('Volunteer · Polling station 1 Demo School');
    // The ended role is in the history, not the list.
    expect(row).not.toHaveTextContent('Campaign manager');
    expect(lastList().get('active')).toBe('true');
    expect(lastList().get('limit')).toBe('50');
  });

  it('filters by role, search, place and "active only"', async () => {
    // At the booth, only the volunteer.
    const { lastList } = setUp((request) => {
      const url = new URL(request.url);
      return url.pathname === '/api/v1/users' && url.searchParams.get('nodeId') === BOOTH.id
        ? [200, { items: [VOLUNTEER], nextCursor: null }]
        : undefined;
    });
    await table(/Users in your area/);
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'volunteer' } });
    await waitFor(() => expect(lastList().get('role')).toBe('volunteer'));
    fireEvent.change(screen.getByLabelText('Name or phone'), { target: { value: ' asha ' } });
    await waitFor(() => expect(lastList().get('q')).toBe('asha'));
    fireEvent.click(screen.getByLabelText('Only people with an active role'));
    await waitFor(() => expect(lastList().has('active')).toBe(false));

    // The place: the admin's own AC first, then the levels below it.
    const area = screen.getByLabelText('Your area');
    expect(
      within(area)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All of my area', 'AC 101 Demo AC']);
    fireEvent.change(area, { target: { value: AC.id } });
    await waitFor(() => expect(lastList().get('nodeId')).toBe(AC.id));
    fireEvent.change(await screen.findByLabelText('Part'), { target: { value: PART.id } });
    await waitFor(() => expect(lastList().get('nodeId')).toBe(PART.id));
    fireEvent.change(await screen.findByLabelText('Polling station'), {
      target: { value: BOOTH.id },
    });
    await waitFor(() => expect(lastList().get('nodeId')).toBe(BOOTH.id));
    await waitFor(() => expect(screen.queryByText('Test Admin', { selector: 'td' })).toBeNull());
    // Back up a level: the part again (from the cache).
    fireEvent.change(screen.getByLabelText('Polling station'), { target: { value: '' } });
    expect(await screen.findByText('Test Admin', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByLabelText('Part')).toHaveValue(PART.id);

    // Another part (without stations yet): the station dropdown goes.
    fireEvent.change(screen.getByLabelText('Polling station'), { target: { value: BOOTH.id } });
    await waitFor(() => expect(lastList().get('nodeId')).toBe(BOOTH.id));
    fireEvent.change(screen.getByLabelText('Part'), { target: { value: PART2.id } });
    await waitFor(() => expect(lastList().get('nodeId')).toBe(PART2.id));
    await waitFor(() => expect(screen.queryByLabelText('Polling station')).toBeNull());
  });

  it('says when a level of the place picker can’t load', async () => {
    setUp((request) =>
      new URL(request.url).pathname === '/api/v1/geographies'
        ? [400, errorBody('VALIDATION_FAILED', 'Bad')]
        : undefined,
    );
    await table(/Users in your area/);
    fireEvent.change(screen.getByLabelText('Your area'), { target: { value: AC.id } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Some details aren');
  });

  it('loads the next page with the cursor', async () => {
    const { lastList } = setUp((request) => {
      const url = new URL(request.url);
      if (url.pathname !== '/api/v1/users') return undefined;
      return url.searchParams.get('cursor') === 'c2'
        ? [200, { items: [VOLUNTEER], nextCursor: null }]
        : [200, { items: [ADMIN], nextCursor: 'c2' }];
    });
    await table(/Users in your area/);
    expect(screen.queryByText('Asha Volunteer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Asha Volunteer')).toBeInTheDocument();
    expect(lastList().get('cursor')).toBe('c2');
    expect(screen.getByText('Test Admin', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('says when nobody is there, or nobody matches', async () => {
    setUp((request) =>
      new URL(request.url).pathname === '/api/v1/users'
        ? [200, { items: [], nextCursor: null }]
        : undefined,
    );
    expect(await screen.findByText('There are no users in your area yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } });
    expect(await screen.findByText('No users match these filters.')).toBeInTheDocument();
  });

  it('shows the denied state without the admin role', async () => {
    setUp((request) =>
      new URL(request.url).pathname === '/api/v1/users'
        ? [403, errorBody('FORBIDDEN', 'Forbidden')]
        : undefined,
    );
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });
});

describe('UsersPage detail', () => {
  const open = async (name: string) => {
    const list = await table(/Users in your area/);
    fireEvent.click(within(list).getByRole('button', { name: `Open ${name}` }));
    return table(new RegExp(`Roles of ${name}`));
  };

  it('shows the role history, active and ended', async () => {
    setUp();
    const history = await open('Asha Volunteer');
    const rows = within(history).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent(
      /Volunteer.*Polling station 1 Demo School.*No end date.*Active.*Test Admin/,
    );
    expect(rows[1]).toHaveTextContent(/Campaign manager.*Part 1 Demo Nagar.*Ended/);
    // An ended role can't be ended again.
    expect(within(rows[1]!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers no "End role" on the admin’s own admin role', async () => {
    setUp();
    const history = await open('Test Admin');
    expect(within(history).getByText('Server setup')).toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: /End/ })).not.toBeInTheDocument();
  });

  it('ends a role after confirming, with an idempotency key', async () => {
    const { sent } = setUp((request) =>
      request.method === 'DELETE'
        ? [200, assignment('ra-vol', 'u-vol', 'volunteer', BOOTH, { active: false })]
        : undefined,
    );
    const history = await open('Asha Volunteer');
    fireEvent.click(
      within(history).getByRole('button', {
        name: 'End Volunteer at Polling station 1 Demo School',
      }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'End this role?' });
    expect(dialog).toHaveTextContent(
      'Asha Volunteer stops being Volunteer at Polling station 1 Demo School now.',
    );
    expect(sent('DELETE', '/api/v1/role-assignments/ra-vol')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'End role' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const [end] = sent('DELETE', '/api/v1/role-assignments/ra-vol');
    expect(end!.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows the API’s reason when ending fails, and cancel sends nothing', async () => {
    const { sent } = setUp((request) =>
      request.method === 'DELETE'
        ? [422, errorBody('UNPROCESSABLE', 'This assignment has already ended')]
        : undefined,
    );
    const history = await open('Asha Volunteer');
    const endButton = within(history).getByRole('button', { name: /^End Volunteer/ });
    fireEvent.click(endButton);
    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(sent('DELETE', '/api/v1/role-assignments/ra-vol')).toHaveLength(0);

    fireEvent.click(endButton);
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'End role' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This assignment has already ended',
    );
  });

  it('gives a role: a volunteer only on a polling station, and the API’s 422 as it is', async () => {
    let answer: Reply = [
      422,
      errorBody('UNPROCESSABLE', 'The user already has this role on this node then'),
    ];
    const { sent } = setUp((request) =>
      request.method === 'POST' && new URL(request.url).pathname === '/api/v1/role-assignments'
        ? answer
        : undefined,
    );
    await open('Asha Volunteer');
    const form = screen.getByRole('form', { name: 'Give a role' });
    const give = within(form).getByRole('button', { name: 'Give role' });

    fireEvent.click(give);
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose a place for the role.');
    fireEvent.change(within(form).getByLabelText('Your area'), { target: { value: AC.id } });
    fireEvent.click(give);
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'Volunteers are assigned to a polling station.',
    );
    fireEvent.change(await within(form).findByLabelText('Part'), { target: { value: PART.id } });
    fireEvent.change(await within(form).findByLabelText('Polling station'), {
      target: { value: BOOTH.id },
    });
    fireEvent.click(give);
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'The user already has this role on this node then',
    );
    const [first] = sent('POST', '/api/v1/role-assignments');
    expect(JSON.parse(first!.body!)).toEqual({
      userId: 'u-vol',
      role: 'volunteer',
      geographyNodeId: BOOTH.id,
    });
    expect(first!.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

    // A campaign manager on the AC, from a date.
    answer = [201, assignment('ra-new', 'u-vol', 'campaign_manager', AC)];
    fireEvent.change(within(form).getByLabelText('Role'), {
      target: { value: 'campaign_manager' },
    });
    fireEvent.change(within(form).getByLabelText('Part'), { target: { value: '' } });
    fireEvent.change(within(form).getByLabelText('Starts (optional)'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.click(give);
    expect(await within(form).findByRole('status')).toHaveTextContent('Role given.');
    const second = sent('POST', '/api/v1/role-assignments')[1]!;
    expect(JSON.parse(second.body!)).toEqual({
      userId: 'u-vol',
      role: 'campaign_manager',
      geographyNodeId: AC.id,
      validFrom: new Date('2026-10-01T00:00:00').toISOString(),
    });
  });
});

describe('UsersPage add user', () => {
  const fill = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Add a user' }));
    const form = screen.getByRole('region', { name: 'Add a user' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: ' Ravi Test ' } });
    fireEvent.change(within(form).getByLabelText('Phone number'), {
      target: { value: '+919999900150' },
    });
    fireEvent.change(within(form).getByLabelText('Language'), { target: { value: 'te' } });
    fireEvent.change(within(form).getByLabelText('Your area'), { target: { value: AC.id } });
    fireEvent.change(await within(form).findByLabelText('Part'), { target: { value: PART.id } });
    fireEvent.change(await within(form).findByLabelText('Polling station'), {
      target: { value: BOOTH.id },
    });
    return form;
  };
  const created = (isNew: boolean) => ({
    user: user('u-new', 'Ravi Test', [assignment('ra-new', 'u-new', 'volunteer', BOOTH)]),
    assignment: assignment('ra-new', 'u-new', 'volunteer', BOOTH),
    created: isNew,
  });

  it('adds a volunteer to a booth, then shows them', async () => {
    const { sent } = setUp((request) => {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/api/v1/users') return [201, created(true)];
      if (path === '/api/v1/users/u-new') return [200, created(true).user];
      return undefined;
    });
    const form = await fill();
    fireEvent.change(within(form).getByLabelText('Ends (optional)'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ravi Test was added.');
    expect(await table(/Roles of Ravi Test/)).toBeInTheDocument();
    const [post] = sent('POST', '/api/v1/users');
    expect(JSON.parse(post!.body!)).toEqual({
      name: 'Ravi Test',
      phone: '+919999900150',
      preferredLanguage: 'te',
      role: 'volunteer',
      geographyNodeId: BOOTH.id,
      validUntil: new Date('2026-12-31T00:00:00').toISOString(),
    });
    expect(post!.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // The list is fetched again.
    await waitFor(() => expect(sent('GET', '/api/v1/users').length).toBeGreaterThan(1));
  });

  it('says when the phone already belonged to a user, who got the role', async () => {
    setUp((request) => {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/api/v1/users') return [201, created(false)];
      if (path === '/api/v1/users/u-new') return [200, created(false).user];
      return undefined;
    });
    const form = await fill();
    fireEvent.click(within(form).getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ravi Test already had an account in your organization, and got the new role.',
    );
  });

  it('checks the phone format, and says when the phone can’t be used (409)', async () => {
    const { sent } = setUp((request) =>
      request.method === 'POST'
        ? [409, errorBody('CONFLICT', 'This phone number can’t be used')]
        : undefined,
    );
    const form = await fill();
    fireEvent.change(within(form).getByLabelText('Phone number'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add user' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'Enter the phone number in international format',
    );
    expect(sent('POST', '/api/v1/users')).toHaveLength(0);

    fireEvent.change(within(form).getByLabelText('Phone number'), {
      target: { value: '+919999900999' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add user' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      "This phone number can't be used.",
    );
  });

  it('checks the dates, and Cancel closes the form', async () => {
    setUp();
    const form = await fill();
    fireEvent.change(within(form).getByLabelText('Starts (optional)'), {
      target: { value: '2026-12-01' },
    });
    fireEvent.change(within(form).getByLabelText('Ends (optional)'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add user' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'The end date must be after the start date.',
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Add a user' })).not.toBeInTheDocument();
  });
});
