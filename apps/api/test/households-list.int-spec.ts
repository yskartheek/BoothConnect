import { randomUUID } from 'node:crypto';

import type { Page } from '../src/common/pagination';
import type { HouseholdSummary } from '../src/households/households.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic), in this file's own database: 40 households over stations
// 1 and 1A (part 1) and 2 (part 2). Volunteer A works at station 1, volunteer
// B at station 2, the admin on AC 101.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';

type List = Page<HouseholdSummary>;

describe('GET /v1/households (real Postgres)', () => {
  let t: TestApp;
  let station1: string;
  let station2: string;

  const station = async (code: string) =>
    (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
      .id;
  const idsAt = async (pollingStationId: string) =>
    (
      await t.prisma.household.findMany({
        where: { pollingStationId, status: 'active' },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => row.id);
  const list = async (who: SignedIn, query = '') =>
    (await who.http.get(`/v1/households${query}`).expect(200)).body as List;
  const all = async (who: SignedIn, query: string, limit = 7) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const sep = query ? '&' : '?';
      const page: List = await list(
        who,
        `${query}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
      );
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  };
  const visit = async (
    householdId: string,
    outcome: 'completed' | 'follow_up_requested',
    at: Date,
    corrects?: string,
  ) => {
    const volunteer = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } });
    return t.prisma.visit.create({
      data: {
        householdId,
        volunteerId: volunteer.id,
        startedAt: at,
        outcome,
        formVersion: 'test',
        clientId: randomUUID(),
        correctsVisitId: corrects,
      },
    });
  };

  beforeAll(async () => {
    t = await createTestApp();
    station1 = await station('1');
    station2 = await station('2');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a signed-in user', async () => {
    await t.http().get('/v1/households').expect(401);
  });

  it('volunteer A sees exactly the households of booth 1, with member counts', async () => {
    const a = await loginAs(t, VOLUNTEER_A);
    const expected = await idsAt(station1);
    expect(expected.length).toBeGreaterThan(0);

    const ids = await all(a, '');
    expect(ids).toEqual(expected);

    const [first] = (await list(a, '?limit=1')).items;
    const members = await t.prisma.voter.count({
      where: { householdId: first?.id, recordStatus: 'active' },
    });
    expect(first).toMatchObject({
      pollingStationId: station1,
      voterCount: members,
      lastVisit: null,
    });
  });

  it('a boothId outside the scope gives an empty page, nothing else', async () => {
    const a = await loginAs(t, VOLUNTEER_A);
    await expect(list(a, `?boothId=${station2}`)).resolves.toEqual({ items: [], nextCursor: null });

    const admin = await loginAs(t, ADMIN);
    expect(await all(admin, `?boothId=${station2}`)).toEqual(await idsAt(station2));
  });

  it('the admin sees all active households of the AC', async () => {
    const admin = await loginAs(t, ADMIN);
    const ids = await all(admin, '', 9);
    expect(ids).toHaveLength(await t.prisma.household.count({ where: { status: 'active' } }));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pagination is stable: adding a household while paging repeats and skips nothing', async () => {
    const a = await loginAs(t, VOLUNTEER_A);
    const before = await idsAt(station1);
    const first = await list(a, '?limit=3');
    expect(first.items.map((item) => item.id)).toEqual(before.slice(0, 3));

    const part1 = await t.prisma.geographyNode.findFirstOrThrow({
      where: { type: 'part', code: '1' },
    });
    const added = await t.prisma.household.create({
      data: {
        partId: part1.id,
        pollingStationId: station1,
        houseKey: 'NEW-1',
        displayAddress: 'New house while paging',
        origin: 'volunteer_added',
      },
    });

    const rest: string[] = [];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await list(a, `?limit=3&cursor=${cursor}`);
      rest.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    // Every household that existed is seen exactly once, in order. The new one
    // appears only if it sorts after the page already read (keyset paging).
    const seen = [...first.items.map((item) => item.id), ...rest];
    expect(seen.filter((id) => id !== added.id)).toEqual(before);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.includes(added.id)).toBe(added.id > (first.items.at(-1)?.id ?? ''));
  });

  describe('search', () => {
    it('finds by part of the address and by house number', async () => {
      const a = await loginAs(t, VOLUNTEER_A);
      const target = await t.prisma.household.findFirstOrThrow({
        where: { pollingStationId: station1 },
        orderBy: { id: 'desc' },
      });
      const fragment = target.displayAddress.slice(1, 6);
      const byAddress = await all(a, `?q=${encodeURIComponent(fragment)}`);
      expect(byAddress).toContain(target.id);

      const byHouse = await all(a, `?q=${encodeURIComponent(target.houseKey)}`);
      expect(byHouse).toContain(target.id);
    });

    it('finds by a member’s name and EPIC number', async () => {
      const a = await loginAs(t, VOLUNTEER_A);
      const voter = await t.prisma.voter.findFirstOrThrow({
        where: { pollingStationId: station1, origin: 'official_import' },
      });
      const name = (voter.sourceData as { name: string }).name;
      expect(await all(a, `?q=${encodeURIComponent(name.toLowerCase())}`)).toContain(
        voter.householdId,
      );
      expect(await all(a, `?q=${voter.sourceVoterId?.slice(0, 7) ?? ''}`)).toContain(
        voter.householdId,
      );
    });

    it('finds a volunteer-added member by the name a volunteer entered', async () => {
      const added = await t.prisma.voter.findFirstOrThrow({ where: { origin: 'volunteer_added' } });
      const nameField = await t.prisma.fieldValue.findFirstOrThrow({
        where: { entityId: added.id, isCurrent: true, fieldDefinition: { key: 'name' } },
      });
      const admin = await loginAs(t, ADMIN);
      const found = await all(admin, `?q=${encodeURIComponent(nameField.value as string)}`);
      expect(found).toContain(added.householdId);
    });

    it('never returns booth B’s households to volunteer A', async () => {
      const b = await t.prisma.voter.findFirstOrThrow({
        where: { pollingStationId: station2, origin: 'official_import' },
      });
      const name = (b.sourceData as { name: string }).name;
      const owner = await loginAs(t, VOLUNTEER_B);
      expect(await all(owner, `?q=${encodeURIComponent(name)}`)).toContain(b.householdId);

      const a = await loginAs(t, VOLUNTEER_A);
      const seen = await all(a, `?q=${encodeURIComponent(name)}`);
      expect(seen).not.toContain(b.householdId);
      const onB = await t.prisma.household.findMany({ where: { id: { in: seen } } });
      expect(onB.every((h) => h.pollingStationId === station1)).toBe(true);
    });

    it('treats % and _ literally', async () => {
      const a = await loginAs(t, VOLUNTEER_A);
      await expect(list(a, '?q=%25')).resolves.toEqual({ items: [], nextCursor: null });
    });
  });

  describe('visit status filter', () => {
    it('uses the latest effective visit: not_visited, visited, follow_up', async () => {
      const a = await loginAs(t, VOLUNTEER_A);
      const [h1, h2, h3] = await idsAt(station1);
      const day = (n: number) => new Date(Date.UTC(2026, 8, n));

      await visit(h1!, 'completed', day(1));
      await visit(h2!, 'completed', day(1));
      await visit(h2!, 'follow_up_requested', day(2));
      // h3: a follow-up that was later corrected to "completed".
      const wrong = await visit(h3!, 'follow_up_requested', day(3));
      await visit(h3!, 'completed', day(3), wrong.id);

      const visited = await all(a, '?status=visited');
      expect(visited).toEqual(expect.arrayContaining([h1, h2, h3]));
      expect(await all(a, '?status=follow_up')).toEqual([h2]);

      const notVisited = await all(a, '?status=not_visited');
      expect(notVisited).not.toEqual(expect.arrayContaining([h1]));
      expect(notVisited.length + visited.length).toBe((await idsAt(station1)).length);

      const page = await list(a, '?status=follow_up');
      expect(page.items[0]?.lastVisit).toMatchObject({ outcome: 'follow_up_requested' });
    });
  });

  it('rejects invalid parameters with 400', async () => {
    const a = await loginAs(t, VOLUNTEER_A);
    await a.http.get('/v1/households?status=done').expect(400);
    await a.http.get('/v1/households?boothId=x').expect(400);
    await a.http.get('/v1/households?limit=0').expect(400);
    await a.http.get('/v1/households?cursor=zzz').expect(400);
  });
});
