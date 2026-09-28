import { randomUUID } from 'node:crypto';

import { ScopeService } from '../src/authz/scope.service';
import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { type FieldChange, FieldValuesService } from '../src/field-values/field-values.service';
import type { SyncPage } from '../src/sync/sync.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Seed (synthetic), in this file's own database: volunteer A works at station
// 1, volunteer B at station 2. Voter part1:1 (station 1) has two values
// entered by volunteer A. Caste/community is consent-gated; religion and
// political affiliation are disabled.
const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';

type Kind = 'fieldDefinitions' | 'households' | 'voters' | 'fieldValues' | 'visits';
const KINDS: Kind[] = ['fieldDefinitions', 'households', 'voters', 'fieldValues', 'visits'];

describe('GET /v1/sync/pull (real Postgres)', () => {
  let t: TestApp;
  let a: SignedIn;
  let b: SignedIn;
  let station1: string;
  let station2: string;

  const station = async (code: string) =>
    (await t.prisma.geographyNode.findFirstOrThrow({ where: { type: 'polling_station', code } }))
      .id;
  const pull = async (who: SignedIn, since?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (limit) params.set('limit', String(limit));
    return (await who.http.get(`/v1/sync/pull?${params.toString()}`).expect(200)).body as SyncPage;
  };
  /** Pages until done; returns every page. */
  const pullAll = async (who: SignedIn, since?: string, limit?: number) => {
    const pages: SyncPage[] = [];
    let cursor = since;
    do {
      const page = await pull(who, cursor, limit);
      pages.push(page);
      cursor = page.cursor;
      if (!page.hasMore) break;
    } while (pages.length < 1000);
    return pages;
  };
  const idsOf = (pages: SyncPage[], kind: Kind) =>
    pages.flatMap((page) => (page[kind] as { id: string }[]).map((row) => row.id));
  const write = async (phone: string, ...changes: FieldChange[]) => {
    const user = await t.prisma.appUser.findUniqueOrThrow({ where: { phone } });
    const scope = await t.app.get(ScopeService).resolve(user.id);
    return t.app.get(FieldValuesService).write(scope, user.id, changes);
  };
  const change = (
    voterId: string,
    fieldKey: string,
    value: unknown,
    baseVersion: string | null = null,
  ) => ({ entityType: 'voter', entityId: voterId, fieldKey, value, baseVersion }) as FieldChange;
  let spare = 0;
  const voterAt = async (stationId: string) => {
    const voters = await t.prisma.voter.findMany({
      where: { pollingStationId: stationId, origin: 'official_import' },
      orderBy: { serialNo: 'desc' },
    });
    spare += 1;
    return voters[spare]!;
  };
  /** The cursor at the end of a full pull: "the phone is up to date". */
  const upToDate = async (who: SignedIn) => (await pullAll(who)).at(-1)!.cursor;

  beforeAll(async () => {
    t = await createTestApp();
    station1 = await station('1');
    station2 = await station('2');
    a = await loginAs(t, VOLUNTEER_A);
    b = await loginAs(t, VOLUNTEER_B);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('needs a signed-in user', async () => {
    await t.http().get('/v1/sync/pull').expect(401);
  });

  it('the first pull is a full snapshot of the caller’s booth', async () => {
    const pages = await pullAll(a);
    expect(pages).toHaveLength(1);
    const [snapshot] = pages;
    expect(snapshot).toMatchObject({
      reset: true,
      hasMore: false,
      conflicts: [],
      removedFieldValueIds: [],
    });

    const households = await t.prisma.household.findMany({
      where: { pollingStationId: station1, status: 'active' },
    });
    expect(idsOf(pages, 'households').sort()).toEqual(households.map((h) => h.id).sort());
    const voters = await t.prisma.voter.findMany({
      where: { pollingStationId: station1, recordStatus: 'active' },
    });
    expect(idsOf(pages, 'voters').sort()).toEqual(voters.map((v) => v.id).sort());

    // Enabled fields only (caste included for a volunteer); current values only.
    const keys = snapshot!.fieldDefinitions.map((d) => d.key);
    expect(keys).toContain('caste_community');
    expect(keys).not.toContain('religion');
    const current = await t.prisma.fieldValue.count({
      where: { isCurrent: true, entityId: { in: voters.map((v) => v.id) } },
    });
    expect(snapshot!.fieldValues).toHaveLength(current);
    expect(snapshot!.fieldValues.length).toBeGreaterThan(0);
    expect(snapshot!.fieldValues.every((v) => v.isCurrent)).toBe(true);
  });

  it('pages through a large snapshot without losing or repeating anything', async () => {
    const [whole] = await pullAll(a);
    const pages = await pullAll(a, undefined, 7);
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) {
      const size = KINDS.reduce((n, kind) => n + (page[kind] as unknown[]).length, 0);
      expect(size).toBeLessThanOrEqual(7);
    }
    expect(pages.slice(0, -1).every((p) => p.hasMore && p.conflicts.length === 0)).toBe(true);
    for (const kind of KINDS) {
      const ids = idsOf(pages, kind);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.sort()).toEqual(idsOf([whole!], kind).sort());
    }
  });

  it('a pull after an edit returns only the change', async () => {
    const since = await upToDate(a);
    const empty = await pull(a, since);
    expect(empty).toMatchObject({ reset: false, hasMore: false });
    for (const kind of KINDS) expect(empty[kind]).toEqual([]);

    const voter = await voterAt(station1);
    const [first] = await write(VOLUNTEER_A, change(voter.id, 'occupation', 'Farmer'));
    const pages = await pullAll(a, empty.cursor);
    expect(pages.at(-1)!.reset).toBe(false);
    for (const kind of ['fieldDefinitions', 'households', 'voters', 'visits'] as const) {
      expect(idsOf(pages, kind)).toEqual([]);
    }
    const [value] = pages.flatMap((p) => p.fieldValues);
    expect(pages.flatMap((p) => p.fieldValues)).toHaveLength(1);
    expect(value).toMatchObject({
      id: first?.status === 'applied' ? first.fieldValueId : '',
      entityId: voter.id,
      fieldKey: 'occupation',
      value: 'Farmer',
      isCurrent: true,
      collectedBy: { name: expect.any(String) },
    });

    // Superseding it sends the new value and the old one, now not current.
    const [second] = await write(VOLUNTEER_A, change(voter.id, 'occupation', 'Trader', value!.id));
    const nextPages = await pullAll(a, pages.at(-1)!.cursor);
    const next = nextPages.flatMap((p) => p.fieldValues);
    expect(next.map((v) => [v.value, v.isCurrent]).sort()).toEqual([
      ['Farmer', false],
      ['Trader', true],
    ]);
    expect(second?.status).toBe('applied');

    // The cursor moves on: what was sent isn't sent again.
    const quiet = await pull(a, nextPages.at(-1)!.cursor);
    for (const kind of KINDS) expect(quiet[kind]).toEqual([]);
  });

  it('a visit recorded after the cursor is in the next pull', async () => {
    const since = await upToDate(a);
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station1 },
    });
    const res = await a.http
      .post('/v1/visits')
      .set('Idempotency-Key', randomUUID())
      .send({
        clientId: randomUUID(),
        householdId: household.id,
        startedAt: '2026-09-21T10:00:00.000Z',
        outcome: 'no_one_available',
        formVersion: '2026.1',
      })
      .expect(201);
    const visits = (await pullAll(a, since)).flatMap((p) => p.visits);
    expect(visits).toEqual([
      expect.objectContaining({ id: (res.body as { id: string }).id, outcome: 'no_one_available' }),
    ]);
  });

  it('a change still being written during a pull is not skipped', async () => {
    const voter = await voterAt(station1);
    // A slow transaction writes, then a pull runs before it commits.
    let release!: () => void;
    let written!: () => void;
    const wrote = new Promise<void>((resolve) => (written = resolve));
    const volunteer = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } });
    const scope = await t.app.get(ScopeService).resolve(volunteer.id);
    const slow = t.prisma.$transaction(async (tx) => {
      await t.app
        .get(FieldValuesService)
        .write(scope, volunteer.id, [change(voter.id, 'additional_info', 'slow write')], tx);
      written();
      await new Promise<void>((resolve) => (release = resolve));
    });
    await wrote;
    // A later transaction commits first, so the slow one is below the snapshot's
    // xmax: only the snapshot's list of running transactions still covers it.
    await write(VOLUNTEER_A, change((await voterAt(station1)).id, 'occupation', 'quick write'));
    const during = await pullAll(a, await upToDate(a));
    expect(during.flatMap((p) => p.fieldValues).map((v) => v.value)).toEqual([]);
    expect(during.flatMap((p) => p.fieldValues).map((v) => v.value)).not.toContain('slow write');
    release();
    await slow;

    const after = (await pullAll(a, during.at(-1)!.cursor)).flatMap((p) => p.fieldValues);
    expect(after.map((v) => v.value)).toContain('slow write');
  });

  it('a change made while paging, to data already paged past, comes in the next pull', async () => {
    const since = await upToDate(a);
    await write(VOLUNTEER_A, change((await voterAt(station1)).id, 'occupation', 'Page one'));
    await write(VOLUNTEER_A, change((await voterAt(station1)).id, 'occupation', 'Page two'));
    const first = await pull(a, since, 1);
    expect(first).toMatchObject({ hasMore: true, households: [] });
    expect(first.fieldValues).toHaveLength(1);

    // Households were already paged past when this changes.
    const household = await t.prisma.household.findFirstOrThrow({
      where: { pollingStationId: station1 },
    });
    await t.prisma.household.update({
      where: { id: household.id },
      data: { structuredAddress: { landmark: 'Changed while paging' } },
    });
    const rest = await pullAll(a, first.cursor, 1);
    expect(rest.flatMap((p) => p.households)).toEqual([]);
    expect(rest.flatMap((p) => p.fieldValues)).toHaveLength(1);

    const next = await pullAll(a, rest.at(-1)!.cursor);
    expect(next.flatMap((p) => p.households).map((h) => h.id)).toEqual([household.id]);
  });

  it('an open conflict is returned on every pull until it is resolved', async () => {
    const voter = await voterAt(station1);
    const [base] = await write(VOLUNTEER_A, change(voter.id, 'mobile_number', '+919000000001'));
    const baseId = base?.status === 'applied' ? base.fieldValueId : '';
    const [applied, conflict] = await write(
      VOLUNTEER_A,
      change(voter.id, 'mobile_number', '+919000000002', baseId),
      change(voter.id, 'mobile_number', '+919000000003', baseId),
    );
    expect(conflict?.status).toBe('conflict');

    const first = (await pullAll(a)).at(-1)!;
    const again = (await pullAll(a, first.cursor)).at(-1)!;
    for (const page of [first, again]) {
      const mine = page.conflicts.filter((c) => c.entityId === voter.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ entityType: 'voter', fieldKey: 'mobile_number' });
      expect(mine[0]!.values.map((v) => v.value)).toEqual(['+919000000003', '+919000000002']);
      expect(mine[0]!.values[0]).toMatchObject({
        collectedBy: { name: expect.any(String) },
        collectedAt: expect.any(String),
      });
    }

    // Resolved (as POST /conflicts/:id/resolve will do): keep one value.
    const conflictId = conflict?.status === 'conflict' ? conflict.fieldValueId : '';
    await t.prisma.fieldValue.update({
      where: { id: conflictId },
      data: { conflictWithId: null, isCurrent: false },
    });
    const resolved = await pullAll(a, again.cursor);
    expect(resolved.at(-1)!.conflicts.filter((c) => c.entityId === voter.id)).toEqual([]);
    // The resolution itself arrives as a changed value.
    expect(resolved.flatMap((p) => p.fieldValues).map((v) => v.id)).toContain(conflictId);
    expect(applied?.status).toBe('applied');
  });

  it('a value whose consent is withdrawn is removed from the phone', async () => {
    const voter = await voterAt(station1);
    const volunteer = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } });
    const consent = await t.prisma.consent.create({
      data: {
        subjectVoterId: voter.id,
        purpose: 'caste_community',
        noticeVersion: 'test',
        capturedMethod: 'in_person_verbal',
        capturedById: volunteer.id,
      },
    });
    const [written] = await write(VOLUNTEER_A, {
      ...change(voter.id, 'caste_community', 'Test Community'),
      consentId: consent.id,
    });
    const valueId = written?.status === 'applied' ? written.fieldValueId : '';
    expect((await pullAll(a)).flatMap((p) => p.fieldValues).map((v) => v.id)).toContain(valueId);

    const since = await upToDate(a);
    await t.prisma.consent.update({
      where: { id: consent.id },
      data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawnById: volunteer.id },
    });
    const pages = await pullAll(a, since);
    expect(pages.at(-1)!.removedFieldValueIds).toEqual([valueId]);
    expect(pages.flatMap((p) => p.fieldValues).map((v) => v.id)).not.toContain(valueId);
    expect((await pullAll(a)).flatMap((p) => p.fieldValues).map((v) => v.id)).not.toContain(
      valueId,
    );
  });

  it('booth B’s data never reaches volunteer A', async () => {
    const sinceA = await upToDate(a);
    const sinceB = await upToDate(b);
    const voterB = await voterAt(station2);
    const [written] = await write(VOLUNTEER_B, change(voterB.id, 'occupation', 'Booth B only'));
    const valueId = written?.status === 'applied' ? written.fieldValueId : '';

    const forB = (await pullAll(b, sinceB)).flatMap((p) => p.fieldValues).map((v) => v.id);
    expect(forB).toContain(valueId);
    const forA = await pullAll(a, sinceA);
    expect(forA.flatMap((p) => p.fieldValues)).toEqual([]);

    const snapshot = await pullAll(a);
    const stationsSeen = new Set([
      ...snapshot.flatMap((p) => p.households.map((h) => h.pollingStationId)),
      ...snapshot.flatMap((p) => p.voters.map((v) => v.pollingStationId)),
    ]);
    expect([...stationsSeen]).toEqual([station1]);
    const booth2Voters = await t.prisma.voter.findMany({ where: { pollingStationId: station2 } });
    const aValues = snapshot.flatMap((p) => p.fieldValues.map((v) => v.entityId));
    expect(aValues.filter((id) => booth2Voters.some((v) => v.id === id))).toEqual([]);
  });

  it('a change of booths restarts with a full snapshot', async () => {
    const since = await upToDate(a);
    const volunteer = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: VOLUNTEER_A } });
    const extra = await t.prisma.roleAssignment.create({
      data: { userId: volunteer.id, role: 'volunteer', geographyNodeId: station2 },
    });
    try {
      const pages = await pullAll(a, since);
      expect(pages[0]!.reset).toBe(true);
      expect(pages.flatMap((p) => p.households).some((h) => h.pollingStationId === station2)).toBe(
        true,
      );
    } finally {
      await t.prisma.roleAssignment.delete({ where: { id: extra.id } });
    }
  });

  it('rejects a bad cursor or limit with 400', async () => {
    const res = await a.http.get('/v1/sync/pull?since=garbage').expect(400);
    expect((res.body as ApiErrorBody).code).toBe('BAD_REQUEST');
    await a.http.get('/v1/sync/pull?limit=0').expect(400);
    await a.http.get('/v1/sync/pull?limit=5000').expect(400);
  });
});
