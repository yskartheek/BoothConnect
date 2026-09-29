import { randomUUID } from 'node:crypto';

import type { AuditEventsPage } from '../src/audit/audit-events.service';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

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
