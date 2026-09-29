import { randomUUID } from 'node:crypto';

import { NodeStatsService } from '../src/analytics/node-stats.service';
import type { CoverageChange, StationLayout } from '../src/geography/coverage.service';
import type { SyncPage } from '../src/sync/sync.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002'; // station 1 (main station of part 1)
const VOLUNTEER_AUX = '+919999900091'; // station 1A (auxiliary)

describe('Auxiliary station coverage (real Postgres)', () => {
  let t: TestApp;
  let admin: SignedIn;
  let volunteerA: SignedIn;
  let volunteerAux: SignedIn;
  const ids = {} as Record<'part1' | 'ps1' | 'ps1a' | 'ps1b' | 'ps2', string>;

  const put = (stationId: string, coverage: unknown, status = 200, who = admin) =>
    who.http
      .put(`/v1/geographies/${stationId}/coverage`)
      .set('Idempotency-Key', randomUUID())
      .send({ coverage })
      .expect(status)
      .then((res) => res.body as CoverageChange & { message?: string });
  const layout = async () =>
    (await admin.http.get(`/v1/geographies/${ids.part1}/stations`).expect(200))
      .body as StationLayout;
  const counts = async () =>
    Object.fromEntries((await layout()).stations.map((s) => [s.code, s.voters]));
  /** Serial numbers of the official voters at a station. */
  const serialsAt = async (stationId: string) =>
    (
      await t.prisma.voter.findMany({
        where: { pollingStationId: stationId, origin: 'official_import', recordStatus: 'active' },
        orderBy: { serialNo: 'asc' },
      })
    ).map((v) => v.serialNo);
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const pullAll = async (who: SignedIn, since?: string) => {
    const pages: SyncPage[] = [];
    let cursor = since;
    do {
      const res = await who.http
        .get(`/v1/sync/pull${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`)
        .expect(200);
      const page = res.body as SyncPage;
      pages.push(page);
      cursor = page.cursor;
      if (!page.hasMore) break;
    } while (pages.length < 100);
    return pages;
  };

  beforeAll(async () => {
    t = await createTestApp();
    const node = (type: 'part' | 'polling_station', code: string) =>
      t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });
    ids.part1 = (await node('part', '1')).id;
    ids.ps1 = (await node('polling_station', '1')).id;
    ids.ps1a = (await node('polling_station', '1A')).id;
    ids.ps2 = (await node('polling_station', '2')).id;
    // A second auxiliary station in part 1, with no coverage yet.
    const part1 = await t.prisma.geographyNode.findUniqueOrThrow({ where: { id: ids.part1 } });
    ids.ps1b = (
      await t.prisma.geographyNode.create({
        data: {
          programId: part1.programId,
          parentId: part1.id,
          type: 'polling_station',
          code: '1B',
          name: 'Demo Primary School, Room 3',
          isAuxiliary: true,
        },
      })
    ).id;
    // A volunteer on 1A.
    const seedAdmin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
    const user = await t.prisma.appUser.create({
      data: {
        organizationId: seedAdmin.organizationId,
        name: 'Aux volunteer',
        phone: VOLUNTEER_AUX,
      },
    });
    await t.prisma.roleAssignment.create({
      data: {
        userId: user.id,
        role: 'volunteer',
        geographyNodeId: ids.ps1a,
        grantedById: seedAdmin.id,
      },
    });
    admin = await loginAs(t, ADMIN);
    volunteerA = await loginAs(t, VOLUNTEER_A);
    volunteerAux = await loginAs(t, VOLUNTEER_AUX);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('volunteers get 403', async () => {
    await volunteerA.http.get(`/v1/geographies/${ids.part1}/stations`).expect(403);
    await put(ids.ps1a, { sections: [1] }, 403, volunteerA);
  });

  it('shows the part: section 2 is at 1A, the rest at 1', async () => {
    const got = await layout();
    expect(got.partId).toBe(ids.part1);
    expect(got.stations.map((s) => [s.code, s.isAuxiliary, s.coverage])).toEqual([
      ['1', false, null],
      ['1A', true, { sections: [2] }],
      ['1B', true, null],
    ]);
    expect(await serialsAt(ids.ps1a)).toEqual(range(31, 60));
    // The same layout from one of the stations.
    const fromStation = await admin.http.get(`/v1/geographies/${ids.ps1a}/stations`).expect(200);
    expect((fromStation.body as StationLayout).stations).toEqual(got.stations);
  });

  it('a volunteer on 1A sees only its voters', async () => {
    const voters = (await pullAll(volunteerAux)).flatMap((p) => p.voters);
    const official = await t.prisma.voter.findMany({
      where: { id: { in: voters.map((v) => v.id) }, origin: 'official_import' },
    });
    expect(official.map((v) => v.serialNo).sort((a, b) => a! - b!)).toEqual(range(31, 60));
  });

  it('changing the coverage moves voters and households, audited, and phones start over', async () => {
    const cursorA = (await pullAll(volunteerA)).at(-1)!.cursor;
    const cursorB = (await pullAll(await loginAs(t, '+919999900003'))).at(-1)!.cursor;

    // 1A now takes serial numbers 1–15 (houses 1–5) instead of section 2.
    const change = await put(ids.ps1a, { serials: { from: 1, to: 15 } });
    // 30 back to 1, 15 to 1A, and the member a volunteer added in house 1.
    expect(change.moved).toEqual({ voters: 46, households: 15 });
    expect(change.stations.find((s) => s.code === '1A')).toMatchObject({
      coverage: { serials: { from: 1, to: 15 } },
      voters: 16,
    });
    expect(await serialsAt(ids.ps1a)).toEqual(range(1, 15));
    expect(await serialsAt(ids.ps1)).toEqual(range(16, 60));
    // Every household is at its members' station.
    const mismatched = await t.prisma.voter.count({
      where: {
        partId: ids.part1,
        recordStatus: 'active',
        household: { pollingStationId: { not: ids.ps1a } },
        pollingStationId: ids.ps1a,
      },
    });
    expect(mismatched).toBe(0);
    // Volunteer-added members follow their household.
    const added = await t.prisma.voter.findMany({
      where: { partId: ids.part1, origin: 'volunteer_added', recordStatus: 'active' },
      include: { household: true },
    });
    for (const voter of added)
      expect(voter.pollingStationId).toBe(voter.household.pollingStationId);

    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'geography.coverage', resourceId: ids.ps1a },
      orderBy: { seq: 'desc' },
    });
    expect(audit).toMatchObject({
      actorId: admin.userId,
      metadata: {
        partId: ids.part1,
        coverage: { serials: { from: 1, to: 15 } },
        movedVoters: 46,
        movedHouseholds: 15,
      },
    });

    // The analytics follow.
    await t.app.get(NodeStatsService).drain();
    const stats = await t.prisma.nodeStats.findUniqueOrThrow({ where: { nodeId: ids.ps1a } });
    expect((stats.own as { electors: { total: number } }).electors.total).toBe(16);

    // Phones on the part's booths get a fresh copy; others carry on.
    const nextA = await pullAll(volunteerA, cursorA);
    expect(nextA[0]!.reset).toBe(true);
    const a = await t.prisma.voter.findMany({
      where: { id: { in: nextA.flatMap((p) => p.voters.map((v) => v.id)) } },
    });
    expect(a.some((v) => v.serialNo !== null && v.serialNo <= 15)).toBe(false);
    expect((await pullAll(volunteerAux)).flatMap((p) => p.voters)).toHaveLength(
      (await counts())['1A']!,
    );
    const nextB = await pullAll(await loginAs(t, '+919999900003'), cursorB);
    expect(nextB[0]!.reset).toBe(false);
  });

  it('rejects overlapping coverage, and voters that would be in two stations', async () => {
    // 1A has serials 1–15.
    const serial = await put(ids.ps1b, { serials: { from: 10, to: 20 } }, 422);
    expect(serial.message).toBe('Serial numbers 10–20 overlap 1A (1–15)');
    // Section 1 holds serials 1–30, so 15 voters would be in both.
    const mixed = await put(ids.ps1b, { sections: [1] }, 422);
    expect(mixed.message).toBe('15 voters would be in both 1B and 1A');
    expect(await counts()).toEqual({ '1': expect.any(Number), '1A': 16, '1B': 0 });

    // Section 2 doesn't overlap: 1B takes it.
    const ok = await put(ids.ps1b, { sections: [2] });
    expect(ok.moved.voters).toBe(30);
    expect(await serialsAt(ids.ps1b)).toEqual(range(31, 60));
    const shared = await put(ids.ps1a, { sections: [2, 3] }, 422);
    expect(shared.message).toBe('Section 2 already covered by 1B');
  });

  it('clearing a coverage sends its voters back to the main station', async () => {
    const cleared = await put(ids.ps1a, null);
    expect(cleared.moved).toEqual({ voters: 16, households: 5 });
    expect(await serialsAt(ids.ps1a)).toEqual([]);
    expect(await serialsAt(ids.ps1)).toEqual(range(1, 30));
    expect(cleared.stations.find((s) => s.code === '1A')!.coverage).toBeNull();
    // Back to the seed's layout.
    await put(ids.ps1b, null);
    await put(ids.ps1a, { sections: [2] });
    expect(await serialsAt(ids.ps1a)).toEqual(range(31, 60));
  });

  it("an admin of another part can't see or change this part's stations", async () => {
    const seedAdmin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: ADMIN } });
    const user = await t.prisma.appUser.create({
      data: {
        organizationId: seedAdmin.organizationId,
        name: 'Part 2 admin',
        phone: '+919999900092',
      },
    });
    const part2 = await t.prisma.geographyNode.findFirstOrThrow({
      where: { type: 'part', code: '2' },
    });
    await t.prisma.roleAssignment.create({
      data: {
        userId: user.id,
        role: 'admin',
        geographyNodeId: part2.id,
        grantedById: seedAdmin.id,
      },
    });
    const other = await loginAs(t, '+919999900092');
    await other.http.get(`/v1/geographies/${ids.part1}/stations`).expect(404);
    await put(ids.ps1a, { sections: [1] }, 404, other);
    expect(await serialsAt(ids.ps1a)).toEqual(range(31, 60));
    await other.http.get(`/v1/geographies/${part2.id}/stations`).expect(200);
  });

  it('only an auxiliary station has a coverage; bad input is rejected', async () => {
    const main = await put(ids.ps1, { sections: [5] }, 422);
    expect(main.message).toMatch(/^Only an auxiliary station has a coverage/);
    await put(ids.part1, { sections: [2] }, 404);
    await put(randomUUID(), { sections: [2] }, 404);
    await put(ids.ps1a, { serials: { from: 20, to: 10 } }, 422);
    await put(ids.ps1a, {}, 422);
    await put(ids.ps1a, { sections: [2, 2] }, 422);
    await put(ids.ps1a, { sections: [0] }, 400);
    await admin.http
      .put(`/v1/geographies/${ids.ps1a}/coverage`)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(400);
  });
});
