import { randomUUID } from 'node:crypto';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { SyncPage } from '../src/sync/sync.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

/**
 * The Milestone 1 authorization gate (#51; plan §8). Volunteer A (station 1)
 * tries every scoped endpoint against booth B (station 2, volunteer B's):
 * requests by ID are 404, lists and counts contain nothing from booth B, and
 * writes change nothing. The last test lists every route the API serves and
 * fails when one isn't classified here, so a new scoped endpoint can't be
 * added without a cross-booth test.
 *
 * Seed (synthetic): AC 101 → part 1 (stations 1 and 1A) and part 2
 * (station 2). Volunteer A is assigned to station 1, volunteer B to 2.
 */
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';

/**
 * Every route, and how it is protected. `booth`: scoped to the caller's
 * booths (tested below); `analytics`: admins and campaign managers, scoped to
 * their area; `admin`: admins only; `self`: the caller's own session;
 * `public`: no sign-in.
 */
const ROUTES: Record<string, 'booth' | 'analytics' | 'admin' | 'self' | 'public'> = {
  'GET /geographies': 'booth',
  'GET /geographies/:id': 'booth',
  'POST /geographies/imports': 'admin',
  'POST /geographies': 'admin',
  'PATCH /geographies/:id': 'admin',
  'GET /households': 'booth',
  'GET /households/:id': 'booth',
  'POST /households': 'booth',
  'PATCH /households/:id': 'booth',
  'POST /households/:id/members': 'booth',
  'GET /voters/:id': 'booth',
  'PATCH /voters/:id': 'booth',
  'POST /visits': 'booth',
  'POST /conflicts/:id/resolve': 'booth',
  'GET /sync/pull': 'booth',
  'POST /sync/push': 'booth',
  'GET /analytics/nodes/:id/summary': 'analytics',
  'GET /analytics/nodes/:id/children': 'analytics',
  'GET /analytics/nodes/:id/revisions': 'analytics',
  'POST /imports/batches': 'admin',
  'POST /imports/batches/:id/files': 'admin',
  'POST /imports/batches/:id/files/:fileId/complete': 'admin',
  'GET /imports/batches/:id': 'admin',
  'GET /imports/files/:id/preview': 'admin',
  'GET /imports/files/:id/pages/:page': 'admin',
  'GET /imports/files/:id/rejections.csv': 'admin',
  'PATCH /imports/files/:id/rows/:rowId': 'admin',
  'POST /imports/files/:id/confirm': 'admin',
  'POST /imports/batches/:id/confirm': 'admin',
  'GET /audit-events': 'admin',
  'GET /me': 'self',
  'POST /auth/logout': 'self',
  'POST /auth/otp/request': 'public',
  'POST /auth/otp/verify': 'public',
  'POST /auth/refresh': 'public',
  'GET /health': 'public',
};

describe('cross-booth authorization: volunteer A against booth B (real Postgres)', () => {
  let t: TestApp;
  let a: SignedIn;
  let b: SignedIn;
  let stationA: string;
  let stationB: string;
  let partB: string;
  /** Booth B's records. */
  let householdB: string;
  let voterB: string;
  let visitB: string;
  let conflict: readonly [string, string];

  const node = (type: 'ac' | 'part' | 'polling_station', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });
  const key = () => randomUUID();
  const expectNotFound = (res: { status: number; body: unknown }) => {
    expect(res.status).toBe(404);
    expect((res.body as ApiErrorBody).code).toBe('NOT_FOUND');
  };
  /** Counts of what A might have changed in booth B. */
  const boothBState = async () => ({
    visits: await t.prisma.visit.count({ where: { householdId: householdB } }),
    voters: await t.prisma.voter.count({ where: { householdId: householdB } }),
    fieldValues: await t.prisma.fieldValue.count({
      where: { entityId: { in: [voterB, householdB] } },
    }),
    consents: await t.prisma.consent.count({
      where: { OR: [{ subjectVoterId: voterB }, { subjectHouseholdId: householdB }] },
    }),
    households: await t.prisma.household.count({ where: { pollingStationId: stationB } }),
    openConflicts: await t.prisma.fieldValue.count({
      where: { entityId: voterB, conflictWithId: { not: null }, isCurrent: true },
    }),
  });

  beforeAll(async () => {
    t = await createTestApp();
    a = await loginAs(t, VOLUNTEER_A);
    b = await loginAs(t, VOLUNTEER_B);
    stationA = (await node('polling_station', '1')).id;
    stationB = (await node('polling_station', '2')).id;
    partB = (await node('part', '2')).id;
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: stationB, status: 'active' },
      include: { voters: { where: { recordStatus: 'active' }, take: 1 } },
    });
    householdB = household.id;
    voterB = household.voters[0]!.id;

    // Booth B's own volunteer records a visit and makes a conflict there.
    visitB = (
      (
        await b.http
          .post('/v1/visits')
          .set('Idempotency-Key', key())
          .send({
            clientId: randomUUID(),
            householdId: householdB,
            startedAt: '2026-09-20T10:00:00.000Z',
            outcome: 'completed',
            formVersion: '2026.1',
            memberIdsMet: [voterB],
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    const edit = async (value: string, baseVersion: string | null) =>
      (
        (
          await b.http
            .patch(`/v1/voters/${voterB}`)
            .set('Idempotency-Key', key())
            .send({ fields: [{ fieldKey: 'occupation', value, baseVersion }] })
            .expect(200)
        ).body as { fields: { status: string; fieldValueId: string }[] }
      ).fields[0]!;
    const base = await edit('Base', null);
    const first = await edit('First', base.fieldValueId);
    const second = await edit('Second', base.fieldValueId);
    expect(second.status).toBe('conflict');
    conflict = [second.fieldValueId, first.fieldValueId] as const;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('reads by ID are 404', () => {
    it('geographies: booth B, its part', async () => {
      expectNotFound(await a.http.get(`/v1/geographies/${stationB}`));
      expectNotFound(await a.http.get(`/v1/geographies/${partB}`));
    });

    it('households and voters', async () => {
      expectNotFound(await a.http.get(`/v1/households/${householdB}`));
      expectNotFound(await a.http.get(`/v1/voters/${voterB}`));
      expectNotFound(await a.http.get(`/v1/voters/${voterB}?history=true`));
    });
  });

  describe('lists contain nothing from booth B', () => {
    it('geographies: no booth B node at any level', async () => {
      const seen = new Set<string>();
      const walk = async (parentId?: string) => {
        const res = await a.http
          .get(`/v1/geographies${parentId ? `?parentId=${parentId}` : ''}`)
          .expect(200);
        for (const n of (res.body as { items: { id: string }[] }).items) {
          seen.add(n.id);
          await walk(n.id);
        }
      };
      await walk();
      expect(seen.has(stationA)).toBe(true);
      expect(seen.has(stationB)).toBe(false);
      expect(seen.has(partB)).toBe(false);
      // Asking for booth B's part's children directly gives nothing either.
      const direct = await a.http.get(`/v1/geographies?parentId=${partB}`);
      expect([200, 404]).toContain(direct.status);
      if (direct.status === 200) expect((direct.body as { items: unknown[] }).items).toEqual([]);
    });

    it('households: not listed, not filterable, not found by search', async () => {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await a.http
          .get(`/v1/households?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
          .expect(200);
        const page = res.body as { items: { id: string }[]; nextCursor: string | null };
        ids.push(...page.items.map((h) => h.id));
        cursor = page.nextCursor;
      } while (cursor);
      const bIds = (
        await t.prisma.household.findMany({ where: { pollingStationId: stationB } })
      ).map((h) => h.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id) => bIds.includes(id))).toEqual([]);

      const byBooth = await a.http.get(`/v1/households?boothId=${stationB}`);
      expect([200, 404]).toContain(byBooth.status);
      if (byBooth.status === 200) expect((byBooth.body as { items: unknown[] }).items).toEqual([]);

      const epic = (await t.prisma.voter.findUniqueOrThrow({ where: { id: voterB } }))
        .sourceVoterId!;
      const search = await a.http.get(`/v1/households?q=${encodeURIComponent(epic)}`).expect(200);
      expect((search.body as { items: unknown[] }).items).toEqual([]);
    });

    it('sync pull: no booth B household, voter, value, visit or conflict', async () => {
      const pages: SyncPage[] = [];
      let since: string | null = null;
      do {
        const res = await a.http
          .get(`/v1/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`)
          .expect(200);
        const page = res.body as SyncPage;
        pages.push(page);
        since = page.hasMore ? page.cursor : null;
      } while (since);
      const all = <K extends keyof SyncPage>(k: K) => pages.flatMap((p) => p[k] as unknown[]);
      const households = all('households') as { id: string; pollingStationId: string }[];
      expect(households.length).toBeGreaterThan(0);
      expect(households.every((h) => h.pollingStationId !== stationB)).toBe(true);
      expect(households.map((h) => h.id)).not.toContain(householdB);
      expect((all('voters') as { id: string }[]).map((v) => v.id)).not.toContain(voterB);
      expect(
        (all('fieldValues') as { entityId: string }[]).filter((f) => f.entityId === voterB),
      ).toEqual([]);
      expect((all('visits') as { id: string }[]).map((v) => v.id)).not.toContain(visitB);
      expect(JSON.stringify(all('conflicts'))).not.toContain(conflict[0]);
    });
  });

  describe('writes to booth B are refused and change nothing', () => {
    it('direct requests are 404', async () => {
      const before = await boothBState();
      expectNotFound(
        await a.http
          .patch(`/v1/households/${householdB}`)
          .set('Idempotency-Key', key())
          .send({ address: { house_no: 'X-1' }, addressBaseVersion: null }),
      );
      expectNotFound(
        await a.http
          .post(`/v1/households/${householdB}/members`)
          .set('Idempotency-Key', key())
          .send({ name: 'Intruder', age: 30 }),
      );
      expectNotFound(
        await a.http
          .post('/v1/households')
          .set('Idempotency-Key', key())
          .send({ pollingStationId: stationB, address: { house_no: 'X-2' } }),
      );
      expectNotFound(
        await a.http
          .patch(`/v1/voters/${voterB}`)
          .set('Idempotency-Key', key())
          .send({ fields: [{ fieldKey: 'occupation', value: 'Changed', baseVersion: null }] }),
      );
      expectNotFound(
        await a.http.post('/v1/visits').set('Idempotency-Key', key()).send({
          clientId: randomUUID(),
          householdId: householdB,
          startedAt: '2026-09-21T10:00:00.000Z',
          outcome: 'refused',
          formVersion: '2026.1',
        }),
      );
      expectNotFound(
        await a.http
          .post(`/v1/conflicts/${conflict[0]}/resolve`)
          .send({ keepFieldValueId: conflict[1] }),
      );
      expect(await boothBState()).toEqual(before);
    });

    it('sync push: every booth B item is rejected as not found', async () => {
      const before = await boothBState();
      const mutations = [
        {
          type: 'visit.create',
          payload: {
            clientId: randomUUID(),
            householdId: householdB,
            startedAt: '2026-09-21T10:00:00.000Z',
            outcome: 'completed',
            formVersion: '2026.1',
          },
        },
        {
          type: 'field.change',
          payload: {
            entityType: 'voter',
            entityId: voterB,
            fieldKey: 'occupation',
            value: 'X',
            baseVersion: null,
          },
        },
        {
          type: 'household.update',
          payload: { id: householdB, address: { house_no: 'X-3' }, addressBaseVersion: null },
        },
        { type: 'member.create', payload: { householdId: householdB, name: 'Intruder' } },
        {
          type: 'consent.capture',
          payload: {
            voterId: voterB,
            purpose: 'caste_community',
            noticeVersion: '2026.1',
            method: 'in_person_verbal',
          },
        },
        {
          type: 'household.create',
          payload: { pollingStationId: stationB, address: { house_no: 'X-4' } },
        },
        {
          type: 'conflict.resolve',
          payload: { conflictId: conflict[0], keepFieldValueId: conflict[1] },
        },
      ].map((m) => ({ key: key(), ...m }));
      const res = await a.http
        .post('/v1/sync/push')
        .set('Idempotency-Key', key())
        .send({ mutations })
        .expect(200);
      const results = (res.body as { results: { status: string; code?: string }[] }).results;
      expect(results).toHaveLength(mutations.length);
      for (const [i, result] of results.entries()) {
        expect([mutations[i]!.type, result.status, result.code]).toEqual([
          mutations[i]!.type,
          'rejected',
          'NOT_FOUND',
        ]);
      }
      expect(await boothBState()).toEqual(before);
    });
  });

  describe('analytics', () => {
    it('volunteers get none (403), for their own booth or booth B', async () => {
      for (const id of [stationA, stationB]) {
        for (const path of ['summary', 'children', 'revisions']) {
          await a.http.get(`/v1/analytics/nodes/${id}/${path}`).expect(403);
        }
      }
    });

    it("a campaign manager scoped to booth A: booth B and the areas above are 404, and A's counts hold only A", async () => {
      const volunteerA = await t.prisma.appUser.findUniqueOrThrow({
        where: { phone: VOLUNTEER_A },
      });
      const manager = await t.prisma.appUser.create({
        data: {
          organizationId: volunteerA.organizationId,
          name: 'Synthetic Manager',
          phone: '+919999900099',
          roleAssignments: { create: { role: 'campaign_manager', geographyNodeId: stationA } },
        },
      });
      const m = await loginAs(t, manager.id);
      const [part1, ac] = [await node('part', '1'), await node('ac', '101')];
      for (const id of [stationB, partB, part1.id, ac.id]) {
        for (const path of ['summary', 'children', 'revisions']) {
          const res = await m.http.get(`/v1/analytics/nodes/${id}/${path}`);
          expectNotFound(res);
        }
      }
      const summary = await m.http.get(`/v1/analytics/nodes/${stationA}/summary`).expect(200);
      const total = (summary.body as { metrics: Record<string, unknown> }).metrics[
        'electors.total'
      ];
      const onlyA = await t.prisma.voter.count({
        where: { pollingStationId: stationA, recordStatus: 'active' },
      });
      expect([onlyA, 'suppressed']).toContain(total);
    });
  });

  it('admin-only endpoints are 403 for a volunteer', async () => {
    const id = randomUUID();
    const calls: [string, string][] = Object.entries(ROUTES)
      .filter(([, kind]) => kind === 'admin')
      .map(([route]) => {
        const [method, path] = route.split(' ') as [string, string];
        return [method, path.replace(/:[a-zA-Z]+/g, (p) => (p === ':page' ? '3' : id))];
      });
    for (const [method, path] of calls) {
      const req = a.http[method.toLowerCase() as 'get' | 'post' | 'patch'](`/v1${path}`)
        .set('Idempotency-Key', key())
        .send({});
      expect([`${method} ${path}`, (await req).status]).toEqual([`${method} ${path}`, 403]);
    }
  });

  it('every route the API serves is classified here', () => {
    const served: string[] = [];
    for (const module of t.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const type = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
        if (!type) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
        for (const name of Object.getOwnPropertyNames(type.prototype)) {
          const handler = (type.prototype as Record<string, unknown>)[name];
          if (typeof handler !== 'function' || name === 'constructor') continue;
          const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          if (path === undefined || method === undefined) continue;
          const full = `/${[base, path].filter((p) => p && p !== '/').join('/')}`.replace(
            /\/+/g,
            '/',
          );
          served.push(`${RequestMethod[method]} ${full}`);
        }
      }
    }
    const unclassified = served.filter((r) => !(r in ROUTES));
    // A new route? Classify it in ROUTES and, if it is scoped, add a
    // cross-booth test above (plan §8).
    expect(unclassified).toEqual([]);
    expect(Object.keys(ROUTES).filter((r) => !served.includes(r))).toEqual([]);
  });
});
