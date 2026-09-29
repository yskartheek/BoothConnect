import { randomUUID } from 'node:crypto';

import type { SyncPage } from '../src/sync/sync.service';
import type { RoleAssignmentView, UserCreated, UserSummary } from '../src/users/users.service';
import type { UserPage } from '../src/openapi/responses';
import { UsersService } from '../src/users/users.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Synthetic people only. Seed: the admin is an admin of AC 101 (part 1 with
// stations 1 and 1A, part 2 with station 2); volunteer A is on station 1,
// volunteer B on station 2.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';
const NEW_VOLUNTEER = '+919999900150';

describe('users and role assignments (real Postgres)', () => {
  let t: TestApp;
  let admin: SignedIn;
  const ids: Record<
    'station1' | 'station2' | 'part1' | 'ac101' | 'pc1' | 'ac102' | 'outsider' | 'org',
    string
  > = {} as never;

  const post = (who: SignedIn, path: string, body: object, status: number) =>
    who.http
      .post(path)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(status)
      .then((res) => res.body as unknown);
  const end = (who: SignedIn, id: string, status = 200) =>
    who.http
      .delete(`/v1/role-assignments/${id}`)
      .set('Idempotency-Key', randomUUID())
      .expect(status)
      .then((res) => res.body as RoleAssignmentView & { message?: string });
  const list = async (query = '') =>
    (await admin.http.get(`/v1/users${query}`).expect(200)).body as UserPage;
  const lastAudit = (action: string) =>
    t.prisma.auditEvent.findFirstOrThrow({ where: { action }, orderBy: { seq: 'desc' } });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await loginAs(t, ADMIN);
    const node = async (type: 'polling_station' | 'part' | 'ac' | 'pc', code: string) =>
      (await t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } })).id;
    ids.station1 = await node('polling_station', '1');
    ids.station2 = await node('polling_station', '2');
    ids.part1 = await node('part', '1');
    ids.ac101 = await node('ac', '101');
    ids.pc1 = await node('pc', '1');
    // Another AC under the same PC, outside the admin's area, with its own admin.
    const pc = await t.prisma.geographyNode.findUniqueOrThrow({ where: { id: ids.pc1 } });
    ids.ac102 = (
      await t.prisma.geographyNode.create({
        data: {
          programId: pc.programId,
          parentId: pc.id,
          type: 'ac',
          code: '102',
          name: 'Other AC',
        },
      })
    ).id;
    const seedAdmin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
    ids.org = seedAdmin.organizationId;
    ids.outsider = (
      await t.prisma.appUser.create({
        data: { organizationId: ids.org, name: 'Zed Outside Admin', phone: '+919999900160' },
      })
    ).id;
    await t.prisma.roleAssignment.create({
      data: { userId: ids.outsider, role: 'admin', geographyNodeId: ids.ac102 },
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('volunteers get 403', async () => {
    const volunteer = await loginAs(t, VOLUNTEER_A);
    await volunteer.http.get('/v1/users').expect(403);
    await post(
      volunteer,
      '/v1/users',
      { name: 'X', phone: '+919999900199', role: 'volunteer', geographyNodeId: ids.station1 },
      403,
    );
    await post(
      volunteer,
      '/v1/role-assignments',
      { userId: volunteer.userId, role: 'admin', geographyNodeId: ids.ac101 },
      403,
    );
  });

  it('adds a volunteer to a booth; they then see its households', async () => {
    const created = (await post(
      admin,
      '/v1/users',
      {
        name: 'Synthetic New Volunteer',
        phone: NEW_VOLUNTEER,
        preferredLanguage: 'te',
        role: 'volunteer',
        geographyNodeId: ids.station1,
      },
      201,
    )) as UserCreated;
    expect(created).toMatchObject({
      created: true,
      user: { name: 'Synthetic New Volunteer', phone: NEW_VOLUNTEER, preferredLanguage: 'te' },
      assignment: {
        role: 'volunteer',
        node: { id: ids.station1, type: 'polling_station', code: '1' },
        active: true,
        validUntil: null,
        grantedBy: { id: admin.userId },
      },
    });
    expect(await lastAudit('user.create')).toMatchObject({
      resourceId: created.user.id,
      actorId: admin.userId,
      metadata: {},
    });
    expect(await lastAudit('role.grant')).toMatchObject({
      resourceId: created.assignment.id,
      metadata: { userId: created.user.id, role: 'volunteer', nodeId: ids.station1 },
    });

    const volunteer = await loginAs(t, NEW_VOLUNTEER);
    const households = (await volunteer.http.get('/v1/households?limit=200').expect(200)).body as {
      items: { pollingStationId: string }[];
    };
    expect(households.items.length).toBeGreaterThan(0);
    expect(new Set(households.items.map((h) => h.pollingStationId))).toEqual(
      new Set([ids.station1]),
    );
  });

  it('a phone already in the organization gets the role instead of a new user', async () => {
    const b = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_B } });
    const added = (await post(
      admin,
      '/v1/users',
      {
        name: 'Ignored Name',
        phone: VOLUNTEER_B,
        role: 'volunteer',
        geographyNodeId: ids.station1,
      },
      201,
    )) as UserCreated;
    expect(added).toMatchObject({ created: false, user: { id: b.id, name: b.name } });
    expect(
      added.user.assignments
        .filter((a) => a.active)
        .map((a) => a.node.code)
        .sort(),
    ).toEqual(['1', '2']);
    // Another organization's phone can't be used.
    const other = await t.prisma.organization.create({ data: { name: 'Other Org' } });
    await t.prisma.appUser.create({
      data: { organizationId: other.id, name: 'Other', phone: '+919999900170' },
    });
    const refused = (await post(
      admin,
      '/v1/users',
      { name: 'X', phone: '+919999900170', role: 'volunteer', geographyNodeId: ids.station1 },
      409,
    )) as { message: string };
    expect(refused.message).toBe('This phone number can’t be used');
  });

  it('grants only at or below the admin’s own node, and the role must fit it', async () => {
    const volunteer = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } });
    const grant = (body: object, status: number) =>
      post(admin, '/v1/role-assignments', { userId: volunteer.id, ...body }, status);
    // Above the admin (PC 1) and beside it (AC 102): as if they don't exist.
    await grant({ role: 'admin', geographyNodeId: ids.pc1 }, 404);
    await grant({ role: 'campaign_manager', geographyNodeId: ids.ac102 }, 404);
    await grant({ role: 'admin', geographyNodeId: randomUUID() }, 404);
    // A volunteer goes on a polling station.
    const misfit = (await grant({ role: 'volunteer', geographyNodeId: ids.part1 }, 422)) as {
      message: string;
    };
    expect(misfit.message).toBe('A volunteer is assigned to a polling station');
    // The same role on the same node twice at once.
    await grant({ role: 'volunteer', geographyNodeId: ids.station1 }, 422);
    // A window that ends before it starts.
    await grant(
      {
        role: 'campaign_manager',
        geographyNodeId: ids.ac101,
        validFrom: '2027-01-02T00:00:00Z',
        validUntil: '2027-01-01T00:00:00Z',
      },
      422,
    );
    // A user outside the admin's area can't be found.
    await post(
      admin,
      '/v1/role-assignments',
      { userId: ids.outsider, role: 'campaign_manager', geographyNodeId: ids.ac101 },
      404,
    );
    const ok = (await grant(
      { role: 'campaign_manager', geographyNodeId: ids.part1 },
      201,
    )) as RoleAssignmentView;
    expect(ok).toMatchObject({ role: 'campaign_manager', node: { id: ids.part1 }, active: true });
    await post(
      admin,
      '/v1/users',
      { name: 'X', phone: '919999', role: 'volunteer', geographyNodeId: ids.station1 },
      400,
    );
  });

  it('lists only users of the admin’s area, with only those assignments', async () => {
    const all = await list('?limit=200');
    const phones = all.items.map((u) => u.phone);
    expect(phones).toEqual(
      expect.arrayContaining([ADMIN, VOLUNTEER_A, VOLUNTEER_B, NEW_VOLUNTEER]),
    );
    expect(all.items.some((u) => u.id === ids.outsider)).toBe(false);

    // Someone with roles in and outside the area: only the one inside shows.
    await t.prisma.roleAssignment.create({
      data: { userId: ids.outsider, role: 'campaign_manager', geographyNodeId: ids.station2 },
    });
    const outsider = (await admin.http.get(`/v1/users/${ids.outsider}`).expect(200))
      .body as UserSummary;
    expect(outsider.assignments.map((a) => [a.role, a.node.id])).toEqual([
      ['campaign_manager', ids.station2],
    ]);

    const atStation2 = await list(`?nodeId=${ids.station2}&role=volunteer`);
    expect(atStation2.items.map((u) => u.phone)).toEqual([VOLUNTEER_B]);
    expect((await list('?q=New%20Volunt')).items.map((u) => u.phone)).toEqual([NEW_VOLUNTEER]);
    expect(
      (await list(`?q=${encodeURIComponent('+91999990015')}`)).items.map((u) => u.phone),
    ).toEqual([NEW_VOLUNTEER]);
    await admin.http.get(`/v1/users?nodeId=${ids.ac102}`).expect(404);

    // Pages cover the list once each.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: UserPage = await list(
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...page.items.map((u) => u.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual((await list('?limit=200')).items.map((u) => u.id));
  });

  it('ending a role removes the booth from the volunteer’s scope and resets their sync', async () => {
    const b = await loginAs(t, VOLUNTEER_B);
    const pull = async (since?: string) =>
      (
        await b.http
          .get(`/v1/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`)
          .expect(200)
      ).body as SyncPage;
    let page = await pull();
    while (page.hasMore) page = await pull(page.cursor);
    const cursor = page.cursor;

    const user = (
      await admin.http.get(`/v1/users?q=${encodeURIComponent(VOLUNTEER_B)}`).expect(200)
    ).body as UserPage;
    const atStation1 = user.items[0]!.assignments.find(
      (a) => a.active && a.node.id === ids.station1,
    )!;
    const ended = await end(admin, atStation1.id);
    expect(ended).toMatchObject({ id: atStation1.id, active: false });
    expect(new Date(ended.validUntil!).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await lastAudit('role.end')).toMatchObject({
      resourceId: atStation1.id,
      metadata: { userId: user.items[0]!.id, role: 'volunteer', nodeId: ids.station1 },
    });

    const next = await pull(cursor);
    expect(next.reset).toBe(true);
    const households = (await b.http.get('/v1/households?limit=200').expect(200)).body as {
      items: { pollingStationId: string }[];
    };
    expect(new Set(households.items.map((h) => h.pollingStationId))).toEqual(
      new Set([ids.station2]),
    );
    // Kept as history.
    const history = (await admin.http.get(`/v1/users/${user.items[0]!.id}`).expect(200))
      .body as UserSummary;
    expect(history.assignments.find((a) => a.id === atStation1.id)).toMatchObject({
      active: false,
    });
    expect(
      (await list(`?nodeId=${ids.station1}&active=true&q=${encodeURIComponent(VOLUNTEER_B)}`))
        .items,
    ).toEqual([]);

    // Again: already ended.
    await end(admin, atStation1.id, 422);
  });

  it('an admin can’t end their own admin role, or one outside their area', async () => {
    const own = await t.prisma.roleAssignment.findFirstOrThrow({
      where: { userId: admin.userId, role: 'admin' },
    });
    const refused = await end(admin, own.id, 422);
    expect(refused.message).toBe('You can’t end your own admin role; ask another admin');
    const outside = await t.prisma.roleAssignment.findFirstOrThrow({
      where: { userId: ids.outsider, geographyNodeId: ids.ac102 },
    });
    await end(admin, outside.id, 404);
    await end(admin, randomUUID(), 404);
  });

  it('a volunteer with no role left sees nothing, and can be given a role again', async () => {
    const created = (await list(`?q=${encodeURIComponent(NEW_VOLUNTEER)}`)).items[0]!;
    await end(admin, created.assignments[0]!.id);
    const volunteer = await loginAs(t, NEW_VOLUNTEER);
    // No active role: nothing in scope.
    expect((await volunteer.http.get('/v1/households').expect(200)).body).toEqual({
      items: [],
      nextCursor: null,
    });
    // Still listed (not with active=true), so the admin can give a role again.
    expect((await list(`?q=${encodeURIComponent(NEW_VOLUNTEER)}`)).items).toHaveLength(1);
    expect((await list(`?q=${encodeURIComponent(NEW_VOLUNTEER)}&active=true`)).items).toEqual([]);
    await post(
      admin,
      '/v1/role-assignments',
      { userId: created.id, role: 'volunteer', geographyNodeId: ids.station2 },
      201,
    );
  });

  describe('admin:grant (the first admin, from the server)', () => {
    it('makes someone a State admin, once; they can then grant above the AC', async () => {
      const users = t.app.get(UsersService);
      const first = await users.bootstrapAdmin({
        phone: ADMIN,
        name: 'Ignored',
        nodePath: 'S99',
      });
      expect(first).toMatchObject({ userId: admin.userId, created: false });
      expect(first.assignmentId).not.toBeNull();
      expect(await lastAudit('role.grant')).toMatchObject({
        actorId: null,
        resourceId: first.assignmentId,
        metadata: { userId: admin.userId, role: 'admin', via: 'admin:grant' },
      });
      // Again: already an admin there, nothing changes.
      expect(
        await users.bootstrapAdmin({ phone: ADMIN, name: 'Ignored', nodePath: 'S99' }),
      ).toMatchObject({ assignmentId: null });
      // Now PC 1 is in their area.
      const a = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } });
      await post(
        admin,
        '/v1/role-assignments',
        { userId: a.id, role: 'campaign_manager', geographyNodeId: ids.pc1 },
        201,
      );

      // A new phone becomes a new user of the node's organization.
      const fresh = await users.bootstrapAdmin({
        phone: '+919999900180',
        name: 'Synthetic AC Admin',
        nodePath: 'S99/1/101',
      });
      expect(fresh.created).toBe(true);
      const user = await t.prisma.appUser.findUniqueOrThrow({ where: { id: fresh.userId } });
      expect(user).toMatchObject({ organizationId: ids.org, name: 'Synthetic AC Admin' });

      await expect(
        users.bootstrapAdmin({ phone: '+919999900181', name: 'X', nodePath: 'S99/9' }),
      ).rejects.toThrow('No node at S99/9');
      await expect(
        users.bootstrapAdmin({ phone: '+919999900170', name: 'X', nodePath: 'S99' }),
      ).rejects.toThrow('That phone belongs to a user of another organization');
    });
  });
});
