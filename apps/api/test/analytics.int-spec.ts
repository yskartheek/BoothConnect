import { randomUUID } from 'node:crypto';

import type {
  ChildrenBreakdown,
  AnalyticsSummary,
  Revisions,
} from '../src/analytics/analytics.service';
import { NodeStatsService } from '../src/analytics/node-stats.service';
import { COUNT_KEYS, SUPPRESSED } from '../src/analytics/suppression';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic): S99 → PC 1 → AC 101 → parts 1 and 2 (60 voters and 20
// houses each); the admin is scoped to AC 101. The cohort is 10.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

describe('analytics API (real Postgres)', () => {
  let t: TestApp;
  let admin: SignedIn;
  let stats: NodeStatsService;

  const node = (type: 'state' | 'pc' | 'ac' | 'part' | 'polling_station', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });
  const get = <T>(path: string, who: SignedIn = admin, status = 200) =>
    who.http
      .get(`/v1/analytics/${path}`)
      .expect(status)
      .then((res) => res.body as T);

  beforeAll(async () => {
    t = await createTestApp();
    stats = t.app.get(NodeStatsService);
    await stats.drain();
    admin = await loginAs(t, ADMIN);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('a node summary matches the seed, with definitions and computed_at', async () => {
    const part2 = await node('part', '2');
    const summary = await get<AnalyticsSummary>(`nodes/${part2.id}/summary`);
    const voters = await t.prisma.voter.findMany({
      where: { partId: part2.id, recordStatus: 'active' },
      select: { sourceData: true },
    });
    const women = voters.filter(
      (v) => (v.sourceData as { gender?: string }).gender === 'female',
    ).length;
    expect(summary.node).toMatchObject({ id: part2.id, type: 'part', code: '2' });
    expect(summary.minCohort).toBe(10);
    expect(summary.computedAt).toEqual(expect.any(String));
    expect(summary.metrics['electors.total']).toBe(60);
    expect(summary.metrics['households.total']).toBe(20);
    // Shown, or hidden because part 1's small "unknown gender" group made its
    // women hidden too (then part 2's would give part 1's away via the AC).
    expect([women, SUPPRESSED]).toContain(summary.metrics['electors.female']);
    // Not collected is null, a real zero is 0.
    expect(summary.metrics['revisions.additions']).toBeNull();
    expect(summary.metrics['fieldWork.householdsVisited']).toBe(0);
    expect(summary.metrics['quality.rowsExtracted']).toBe(0);
    expect(summary.definitions['electors.total']).toMatch(/Active voters/);
    expect(summary.definitions['ages.18-19']).toMatch(/first-time/);
  });

  it('the children table: every child, the parent total and average; totals add up', async () => {
    const ac = await node('ac', '101');
    const table = await get<ChildrenBreakdown>(`nodes/${ac.id}/children`);
    expect(table.children.map((c) => c.node.code)).toEqual(['1', '2']);
    const sum = (key: string) => table.children.reduce((n, c) => n + (c.metrics[key] as number), 0);
    for (const key of ['electors.total', 'households.total']) {
      expect(table.total[key]).toBe(sum(key));
      expect(table.average[key]).toBe((table.total[key] as number) / 2);
    }
    const sorted = await get<ChildrenBreakdown>(
      `nodes/${ac.id}/children?metric=electors.total&order=asc`,
    );
    const totals = sorted.children.map((c) => c.metrics['electors.total'] as number);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    await get(`nodes/${ac.id}/children?metric=voter.name`, admin, 400);
  });

  it('a small area is suppressed, also where it could be worked out by subtraction', async () => {
    // A new part 3 with one station and four voters: fewer than the cohort.
    const ac = await node('ac', '101');
    const part3 = await t.prisma.geographyNode.create({
      data: {
        programId: ac.programId,
        parentId: ac.id,
        type: 'part',
        code: '3',
        name: 'Tiny Part',
      },
    });
    const station3 = await t.prisma.geographyNode.create({
      data: {
        programId: ac.programId,
        parentId: part3.id,
        type: 'polling_station',
        code: '3',
        name: 'Tiny School',
      },
    });
    const member = {
      programId: ac.programId,
      partId: part3.id,
      pollingStationId: station3.id,
      origin: 'volunteer_added' as const,
    };
    await t.prisma.household.create({
      data: {
        partId: part3.id,
        pollingStationId: station3.id,
        houseKey: 'T-1',
        displayAddress: 'Tiny house',
        origin: 'volunteer_added',
        voters: { create: [member, member, member, member] },
      },
    });
    await stats.request([part3.id]);
    await stats.drain();

    const table = await get<ChildrenBreakdown>(`nodes/${ac.id}/children`);
    const row = (code: string) => table.children.find((c) => c.node.code === code)!.metrics;
    expect(row('3')['electors.total']).toBe(SUPPRESSED);
    expect(row('3')['electors.unknown']).toBe(SUPPRESSED);
    expect(row('3')['households.total']).toBe(SUPPRESSED);
    // Otherwise part 3 = AC total − parts 1 and 2.
    expect(table.total['electors.total']).toEqual(expect.any(Number));
    expect([row('1')['electors.total'], row('2')['electors.total']]).toContain(SUPPRESSED);
    for (const key of COUNT_KEYS) {
      if (typeof table.total[key] !== 'number') continue;
      const hidden = table.children.filter((c) => c.metrics[key] === SUPPRESSED);
      expect(hidden.length).not.toBe(1);
    }
    // A summary shows the same as its row in the parent's table.
    for (const code of ['1', '2', '3']) {
      const summary = await get<AnalyticsSummary>(`nodes/${(await node('part', code)).id}/summary`);
      expect(summary.metrics).toEqual(row(code));
    }
    const s3 = await get<AnalyticsSummary>(`nodes/${station3.id}/summary`);
    expect(s3.metrics['electors.total']).toBe(SUPPRESSED);
    expect(s3.metrics.votersPerHousehold).toBe(SUPPRESSED);
  });

  it('revisions: a part lists its revisions; the area shows the current changes', async () => {
    const part1 = await node('part', '1');
    const rev = await get<Revisions>(`nodes/${part1.id}/revisions`);
    expect(rev.versions).toHaveLength(1);
    expect(rev.versions[0]).toMatchObject({
      revisionYear: 2026,
      additions: null,
      deletions: null,
    });
    expect(rev.versions[0]!.voters).toBeGreaterThanOrEqual(60);
    expect(rev.current).toEqual({ additions: null, deletions: null, net: null });
    const ac = await get<Revisions>(`nodes/${(await node('ac', '101')).id}/revisions`);
    expect(ac.versions).toEqual([]);
  });

  it('404 outside the caller’s area or for an unknown node; 403 for volunteers', async () => {
    const [state, pc] = [await node('state', 'S99'), await node('pc', '1')];
    // Above the admin's AC.
    await get(`nodes/${state.id}/summary`, admin, 404);
    await get(`nodes/${pc.id}/children`, admin, 404);
    await get(`nodes/${randomUUID()}/revisions`, admin, 404);
    const ac = await node('ac', '101');
    const other = await t.prisma.geographyNode.create({
      data: {
        programId: ac.programId,
        parentId: ac.parentId,
        type: 'ac',
        code: '140',
        name: 'Elsewhere',
      },
    });
    await get(`nodes/${other.id}/summary`, admin, 404);
    const volunteer = await loginAs(t, VOLUNTEER_A);
    await get(`nodes/${ac.id}/summary`, volunteer, 403);
  });
});
