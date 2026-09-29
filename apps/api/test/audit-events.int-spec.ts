import { randomUUID } from 'node:crypto';

import type { AuditEventsPage } from '../src/audit/audit-events.service';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';

describe('GET /v1/audit-events (real Postgres)', () => {
  let t: TestApp;
  let admin: SignedIn;
  let audit: AuditService;
  const resourceId = randomUUID();
  let start: Date;
  let middle: Date;
  let end: Date;

  const list = (query: string, status = 200) =>
    admin.http
      .get(`/v1/audit-events${query}`)
      .expect(status)
      .then((res) => res.body as AuditEventsPage);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

  beforeAll(async () => {
    t = await createTestApp();
    admin = await loginAs(t, ADMIN);
    audit = t.app.get(AuditService);
    // Three test events on one resource: two before `middle`, one after.
    start = new Date();
    await pause();
    for (const [action, result] of [
      ['test.alpha', 'success'],
      ['test.beta', 'failure'],
    ] as const) {
      await audit.record({
        action,
        resourceType: 'test_resource',
        resourceId,
        result,
        actorId: admin.userId,
        metadata: { step: action },
      });
    }
    await pause();
    middle = new Date();
    await pause();
    await audit.record({
      action: 'test.gamma',
      resourceType: 'test_resource',
      resourceId,
      result: 'success',
      metadata: { step: 'gamma' },
    });
    await pause();
    end = new Date();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('a volunteer gets 403', async () => {
    const volunteer = await loginAs(t, VOLUNTEER_A);
    await volunteer.http.get('/v1/audit-events').expect(403);
  });

  it('filters by resource, action (exact or prefix), actor, result and time', async () => {
    const byResource = await list(`?resourceType=test_resource&resourceId=${resourceId}`);
    // Newest first.
    expect(byResource.items.map((e) => e.action)).toEqual([
      'test.gamma',
      'test.beta',
      'test.alpha',
    ]);
    expect(byResource.items[1]).toMatchObject({
      resourceType: 'test_resource',
      resourceId,
      result: 'failure',
      actor: { id: admin.userId },
      metadata: { step: 'test.beta' },
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(byResource.items[0]!.actor).toBeNull();

    expect((await list('?action=test.beta')).items.map((e) => e.action)).toEqual(['test.beta']);
    expect((await list('?action=test.*')).items).toHaveLength(3);
    expect(
      (await list(`?action=test.*&actorId=${admin.userId}`)).items.map((e) => e.action),
    ).toEqual(['test.beta', 'test.alpha']);
    expect((await list('?action=test.*&result=failure')).items.map((e) => e.action)).toEqual([
      'test.beta',
    ]);
    const q = (d: Date) => encodeURIComponent(d.toISOString());
    expect(
      (await list(`?action=test.*&from=${q(start)}&to=${q(middle)}`)).items.map((e) => e.action),
    ).toEqual(['test.beta', 'test.alpha']);
    expect((await list(`?action=test.*&from=${q(middle)}`)).items.map((e) => e.action)).toEqual([
      'test.gamma',
    ]);

    await list(`?from=${q(end)}&to=${q(start)}`, 400);
    await list('?action=DROP TABLE', 400);
    await list('?actorId=nope', 400);
  });

  it('pages through the log without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: AuditEventsPage = await list(
        `?action=test.*&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...page.items.map((e) => e.action));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['test.gamma', 'test.beta', 'test.alpha']);
    await list('?cursor=not-a-cursor', 400);
  });

  it('reading the log is audited', async () => {
    await list(`?resourceId=${resourceId}&action=test.*`);
    const views = await t.prisma.auditEvent.findMany({
      where: { action: 'audit.view', actorId: admin.userId },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    expect(views[0]).toMatchObject({
      resourceType: 'audit_event',
      result: 'success',
      metadata: { filters: { resourceId, action: 'test.*' }, returned: 3 },
    });
  });

  it('verify=true checks the chain of the time range', async () => {
    const ok = await list('?verify=true&limit=1');
    expect(ok.verification).toMatchObject({ intact: true, firstBrokenSeq: null });
    expect(ok.verification!.checked).toBeGreaterThan(3);
    expect((await list('?limit=1')).verification).toBeUndefined();
  });

  describe('by booth or area (nodeId)', () => {
    const ids: Record<string, string> = {};
    const node = (type: 'ac' | 'part' | 'polling_station', code: string) =>
      t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });
    const actions = async (query: string) =>
      (await list(`?limit=200&${query}`)).items
        .filter((e) => e.action.startsWith('area.') || e.action === 'visit.create')
        .map((e) => `${e.action}:${e.resourceId ?? e.actor?.id}`);

    beforeAll(async () => {
      const a = await loginAs(t, VOLUNTEER_A);
      const b = await loginAs(t, VOLUNTEER_B);
      ids.a = a.userId;
      ids.b = b.userId;
      for (const [who, code] of [
        [a, '1'],
        [b, '2'],
      ] as const) {
        const station = await node('polling_station', code);
        const household = await t.prisma.household.findFirstOrThrow({
          where: { pollingStationId: station.id, status: 'active' },
          include: { voters: { take: 1 } },
        });
        ids[`household${code}`] = household.id;
        ids[`voter${code}`] = household.voters[0]!.id;
        // A visit (audited as visit.create on the visit), a household and a
        // member event, and a sign-in by the booth's volunteer.
        const visit = await who.http
          .post('/v1/visits')
          .set('Idempotency-Key', randomUUID())
          .send({
            clientId: randomUUID(),
            householdId: household.id,
            startedAt: '2026-09-20T10:00:00.000Z',
            outcome: 'completed',
            formVersion: '2026.1',
          })
          .expect(201);
        ids[`visit${code}`] = (visit.body as { id: string }).id;
        for (const [action, resourceType, resourceId] of [
          ['area.visit', 'visit', ids[`visit${code}`]],
          ['area.household', 'household', household.id],
          ['area.voter', 'voter', household.voters[0]!.id],
        ] as const) {
          await audit.record({ action, resourceType, resourceId, result: 'success' });
        }
        await audit.record({
          action: 'area.login',
          resourceType: 'session',
          result: 'success',
          actorId: who.userId,
        });
      }
    });

    it("a booth: its records' events and its volunteer's, nothing from the other booth", async () => {
      const station1 = await node('polling_station', '1');
      const got = await actions(`nodeId=${station1.id}`);
      expect(got).toEqual(
        expect.arrayContaining([
          `visit.create:${ids.visit1}`,
          `area.visit:${ids.visit1}`,
          `area.household:${ids.household1}`,
          `area.voter:${ids.voter1}`,
          `area.login:${ids.a}`,
        ]),
      );
      for (const id of [ids.visit2, ids.household2, ids.voter2, ids.b]) {
        expect(got.some((g) => g.endsWith(`:${id}`))).toBe(false);
      }
    });

    it('a part or an AC includes its booths', async () => {
      const [part1, part2, ac] = [
        await node('part', '1'),
        await node('part', '2'),
        await node('ac', '101'),
      ];
      const inPart1 = await actions(`nodeId=${part1.id}`);
      expect(inPart1).toContain(`area.household:${ids.household1}`);
      expect(inPart1).not.toContain(`area.household:${ids.household2}`);
      expect(await actions(`nodeId=${part2.id}`)).toContain(`area.login:${ids.b}`);
      const inAc = await actions(`nodeId=${ac.id}`);
      for (const want of [`visit.create:${ids.visit1}`, `visit.create:${ids.visit2}`]) {
        expect(inAc).toContain(want);
      }
    });

    it('combines with the other filters, and is recorded', async () => {
      const station2 = await node('polling_station', '2');
      // Volunteer A did nothing in booth B.
      expect(await actions(`nodeId=${station2.id}&actorId=${ids.a}`)).toEqual([]);
      expect(await actions(`nodeId=${station2.id}&action=area.login`)).toEqual([
        `area.login:${ids.b}`,
      ]);
      await list(`?nodeId=${randomUUID()}`, 404);
      const view = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'audit.view' },
        orderBy: { seq: 'desc' },
      });
      expect(view.metadata).toMatchObject({
        filters: { nodeId: station2.id, action: 'area.login' },
      });
    });
  });

  // Last: it breaks the chain of this test database.
  it('an edited or deleted event fails verification', async () => {
    const q = (d: Date) => encodeURIComponent(d.toISOString());
    const events = await t.prisma.auditEvent.findMany({
      where: { resourceId },
      orderBy: { seq: 'asc' },
    });
    // Someone with database access bypasses the append-only trigger.
    await t.prisma.$executeRawUnsafe(
      'ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only',
    );
    try {
      await t.prisma.$executeRaw`
        UPDATE audit_event SET metadata = '{"step":"edited"}' WHERE id = ${events[0]!.id}::uuid`;
      const edited = await list(`?verify=true&from=${q(start)}&to=${q(end)}`);
      expect(edited.verification).toEqual({
        checked: 3,
        intact: false,
        firstBrokenSeq: events[0]!.seq.toString(),
      });
      // A range without the edited event is still intact.
      const later = await list(`?verify=true&from=${q(middle)}&to=${q(end)}`);
      expect(later.verification).toMatchObject({ checked: 1, intact: true });

      // Deleting an event breaks the link of the one after it.
      await t.prisma.$executeRaw`DELETE FROM audit_event WHERE id = ${events[1]!.id}::uuid`;
      const deleted = await list(`?verify=true&from=${q(middle)}&to=${q(end)}`);
      expect(deleted.verification).toEqual({
        checked: 1,
        intact: false,
        firstBrokenSeq: events[2]!.seq.toString(),
      });
      const view = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'audit.view' },
        orderBy: { seq: 'desc' },
      });
      expect(view.metadata).toMatchObject({ verified: false });
    } finally {
      await t.prisma.$executeRawUnsafe(
        'ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only',
      );
    }
  });
});
