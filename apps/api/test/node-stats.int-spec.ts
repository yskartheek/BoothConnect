import { createHash, randomUUID } from 'node:crypto';

import { type RawMetrics, sumMetrics } from '../src/analytics/metrics';
import { NodeStatsService } from '../src/analytics/node-stats.service';
import { ImportConfirmService } from '../src/imports/confirm.service';
import type { BatchView } from '../src/imports/imports.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic): S99 → PC 1 → AC 101 → parts 1 and 2; part 1 has station
// 1 and auxiliary 1A (section 2), part 2 has station 2; 20 houses and 60
// voters per part. Volunteer A is assigned to station 1.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

type Stats = { nodeId: string; own: RawMetrics; metrics: RawMetrics; computedAt: Date };

describe('node_stats: per-node analytics with roll-ups', () => {
  let t: TestApp;
  let stats: NodeStatsService;

  const node = (type: 'state' | 'pc' | 'ac' | 'part' | 'polling_station', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });
  const all = async () =>
    new Map(
      ((await t.prisma.nodeStats.findMany()) as unknown as Stats[]).map((s) => [s.nodeId, s]),
    );

  beforeAll(async () => {
    t = await createTestApp();
    stats = t.app.get(NodeStatsService);
    // Start-up found node_stats empty and queued a full build.
    await stats.drain();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('builds every node on start-up, and the numbers match the seed', async () => {
    const byNode = await all();
    expect(byNode.size).toBe(await t.prisma.geographyNode.count());
    for (const station of await t.prisma.geographyNode.findMany({
      where: { type: 'polling_station' },
    })) {
      const voters = await t.prisma.voter.findMany({
        where: { pollingStationId: station.id, recordStatus: 'active' },
        select: { sourceData: true },
      });
      const gender = (g: string) =>
        voters.filter((v) => (v.sourceData as { gender?: string } | null)?.gender === g).length;
      const m = byNode.get(station.id)!.metrics;
      expect(m.electors).toEqual({
        total: voters.length,
        male: gender('male'),
        female: gender('female'),
        thirdGender: gender('third_gender'),
        unknown: voters.length - gender('male') - gender('female') - gender('third_gender'),
      });
      const byAge: Record<string, number> = {};
      for (const v of voters) {
        const age = (v.sourceData as { age?: number } | null)?.age;
        if (typeof age === 'number') byAge[String(age)] = (byAge[String(age)] ?? 0) + 1;
      }
      expect(m.ages.byAge).toEqual(byAge);
      expect(m.households.total).toBe(
        await t.prisma.household.count({
          where: { pollingStationId: station.id, status: 'active' },
        }),
      );
    }
    const [part1, part2, ac] = await Promise.all([
      node('part', '1'),
      node('part', '2'),
      node('ac', '101'),
    ]);
    // 60 official voters per part in the seed, plus any volunteer-added members.
    expect(byNode.get(part1.id)!.metrics.electors.total).toBeGreaterThanOrEqual(60);
    expect(byNode.get(part2.id)!.metrics.electors.total).toBe(60);
    expect(byNode.get(ac.id)!.metrics.households.total).toBe(
      await t.prisma.household.count({ where: { status: 'active' } }),
    );
    // Each seed part came from one confirmed file (quality 1).
    expect(byNode.get(part1.id)!.own.quality).toMatchObject({ files: 1, qualitySum: 1 });
    expect(byNode.get(ac.id)!.metrics.quality).toMatchObject({ files: 2, qualitySum: 2 });
    // Stations with a volunteer (A on 1, B on 2) have their households assigned;
    // auxiliary station 1A has no volunteer.
    for (const code of ['1', '2']) {
      const m = byNode.get((await node('polling_station', code)).id)!.metrics;
      expect(m.fieldWork.householdsAssigned).toBe(m.households.total);
    }
    const s1a = byNode.get((await node('polling_station', '1A')).id)!.metrics;
    expect(s1a.households.total).toBeGreaterThan(0);
    expect(s1a.fieldWork.householdsAssigned).toBe(0);
  });

  it('a parent equals its own counts plus the sum of its children, at every level', async () => {
    const byNode = await all();
    const nodes = await t.prisma.geographyNode.findMany({ select: { id: true, parentId: true } });
    for (const n of nodes) {
      const children = nodes
        .filter((c) => c.parentId === n.id)
        .map((c) => byNode.get(c.id)!.metrics);
      const expected = sumMetrics([...children, byNode.get(n.id)!.own]);
      expect(byNode.get(n.id)!.metrics).toEqual(expected);
    }
    const [state, pc, ac] = [
      await node('state', 'S99'),
      await node('pc', '1'),
      await node('ac', '101'),
    ];
    expect(byNode.get(state.id)!.metrics.electors).toEqual(byNode.get(pc.id)!.metrics.electors);
    expect(byNode.get(pc.id)!.metrics.electors).toEqual(byNode.get(ac.id)!.metrics.electors);
  });

  it('refreshing one part updates only it, its stations and its ancestors', async () => {
    const before = await all();
    const [part2, s2, ac, pc, state, part1, s1, s1a] = await Promise.all([
      node('part', '2'),
      node('polling_station', '2'),
      node('ac', '101'),
      node('pc', '1'),
      node('state', 'S99'),
      node('part', '1'),
      node('polling_station', '1'),
      node('polling_station', '1A'),
    ]);
    await stats.request([part2.id]);
    await stats.drain();
    const after = await all();
    const changed = [...after.values()]
      .filter((s) => s.computedAt.getTime() !== before.get(s.nodeId)!.computedAt.getTime())
      .map((s) => s.nodeId)
      .sort();
    expect(changed).toEqual([part2.id, s2.id, ac.id, pc.id, state.id].sort());
    for (const id of [part1.id, s1.id, s1a.id]) {
      expect(after.get(id)!.computedAt).toEqual(before.get(id)!.computedAt);
    }
    expect(await t.prisma.nodeStatsRequest.count()).toBe(0);
  });

  it('a visit refreshes its station’s field work and the totals above it', async () => {
    const volunteer: SignedIn = await loginAs(t, VOLUNTEER_A);
    const s1 = await node('polling_station', '1');
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: s1.id, status: 'active', visits: { none: {} } },
      include: { voters: { where: { recordStatus: 'active' }, take: 2 } },
    });
    const before = (await all()).get(s1.id)!.metrics.fieldWork;
    await volunteer.http
      .post('/v1/visits')
      .set('Idempotency-Key', randomUUID())
      .send({
        clientId: randomUUID(),
        householdId: household.id,
        startedAt: '2026-09-20T10:00:00.000Z',
        completedAt: '2026-09-20T10:15:00.000Z',
        outcome: 'refused',
        formVersion: '2026.1',
        memberIdsMet: household.voters.map((v) => v.id),
      })
      .expect(201);
    // Queued with the visit, in the same transaction.
    expect(await t.prisma.nodeStatsRequest.count({ where: { nodeId: s1.id } })).toBe(1);
    await stats.drain();
    const byNode = await all();
    const after = byNode.get(s1.id)!.metrics.fieldWork;
    expect(after.householdsVisited).toBe(before.householdsVisited + 1);
    expect(after.outcomes.refused ?? 0).toBe((before.outcomes.refused ?? 0) + 1);
    expect(after.votersMet).toBe(before.votersMet + household.voters.length);
    const ac = await node('ac', '101');
    expect(byNode.get(ac.id)!.metrics.fieldWork.outcomes.refused).toBe(after.outcomes.refused);
  });

  it('a confirmed new revision counts additions and deletions against the previous one', async () => {
    const admin = await loginAs(t, ADMIN);
    const [part2, s2] = await Promise.all([node('part', '2'), node('polling_station', '2')]);
    const kept = await t.prisma.voter.findFirstOrThrow({
      where: { partId: part2.id, origin: 'official_import', recordStatus: 'active' },
      orderBy: { serialNo: 'asc' },
    });
    const batch = (
      (
        await admin.http
          .post('/v1/imports/batches')
          .set('Idempotency-Key', randomUUID())
          .send({ targetNodeId: part2.id })
          .expect(201)
      ).body as BatchView
    ).id;
    const id = randomUUID();
    const epics = [kept.sourceVoterId!, 'NEW0000001', 'NEW0000002'];
    await t.prisma.importFile.create({
      data: {
        id,
        batchId: batch,
        programId: part2.programId,
        fileRef: `imports/${batch}/${id}.pdf`,
        originalName: 'synthetic-part-2.pdf',
        sizeBytes: 100,
        checksum: createHash('sha256').update(id).digest('hex'),
        status: 'ready',
        partNodeId: part2.id,
        qualityScore: 0.8,
        printedTotals: { counts: { male: 3, female: 0, thirdGender: 0, total: 3 } },
        detectedHeader: {
          header: {
            acNumber: 101,
            partNumber: 2,
            revisionYear: 2027,
            revisionType: 'Synthetic Revision 2027',
            pollingStation: { number: '2', name: 'Sample High School' },
            auxiliaryStations: [],
          },
          matching: {
            partNodeId: part2.id,
            proposedPart: null,
            stations: [{ code: '2', name: null, auxiliary: false, nodeId: s2.id }],
            previousSourceVersionId: null,
          },
        },
        rows: {
          create: epics.map((epic, i) => ({
            page: 3,
            boxIndex: i,
            sectionNo: 1,
            serialNo: i + 1,
            status: 'accepted' as const,
            extractedValues: {
              epic,
              name: `Synthetic Person ${i + 1}`,
              houseNumber: `9-${i + 1}`,
              age: 40,
              gender: 'male',
              marker: null,
            },
            ...(i === 2 ? { correctedValues: { age: 41 } } : {}),
          })),
        },
      },
    });
    await admin.http.post(`/v1/imports/files/${id}/confirm`).send({}).expect(202);
    await t.app.get(ImportConfirmService).drain();
    await stats.drain();

    const byNode = await all();
    // Two EPICs are new; 59 of the 60 previous voters are no longer listed.
    expect(byNode.get(s2.id)!.metrics.revisions).toEqual({
      additions: 2,
      deletions: 59,
      stationsCompared: 1,
    });
    expect(byNode.get(part2.id)!.metrics.electors.total).toBe(3);
    expect(byNode.get(part2.id)!.own.quality).toMatchObject({
      files: 1,
      qualitySum: 0.8,
      rowsExtracted: 3,
      rowsCorrected: 1,
      rowsRejected: 0,
    });
    const ac = await node('ac', '101');
    expect(byNode.get(ac.id)!.metrics.revisions).toEqual({
      additions: 2,
      deletions: 59,
      stationsCompared: 1,
    });
  });

  it('a full rebuild gives the same numbers as the incremental refreshes', async () => {
    const incremental = await all();
    await stats.rebuildAll();
    const rebuilt = await all();
    for (const [id, s] of rebuilt) expect(s.metrics).toEqual(incremental.get(id)!.metrics);
  });
});
