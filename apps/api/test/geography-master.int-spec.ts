import { randomUUID } from 'node:crypto';

import type { MasterImportReport, MasterNodeView } from '../src/geography/master-data.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

const AC_ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
const STATE_ADMIN = '+919999900090';

const CSV = [
  'level,code,name,reservation,parent_code,state_code',
  'ac,11,Sample AC Eleven,GEN,1,S98', // before its PC: parents are planned first
  'state,S98,Sample State,,,',
  'pc,1,Sample PC One,GEN,S98,',
  'ac,12,Sample AC Twelve,SC,1,S98',
].join('\n');

describe('Geography master data (real Postgres)', () => {
  let t: TestApp;
  let stateAdmin: SignedIn;
  let acAdmin: SignedIn;

  const upload = (who: SignedIn, csv: string, confirm = false, status = 200) =>
    who.http
      .post('/v1/geographies/imports')
      .set('Idempotency-Key', randomUUID())
      .send({ csv, confirm })
      .expect(status)
      .then((res) => res.body as MasterImportReport & { details?: MasterImportReport });
  const actions = (report: MasterImportReport) =>
    report.rows.map(
      (r) => `${r.line}:${r.action}${r.errors.length ? `(${r.errors.join('; ')})` : ''}`,
    );
  const nodes = (code: string) =>
    t.prisma.geographyNode.findMany({ where: { code }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    t = await createTestApp();
    // An admin of the whole state S99 (the seed admin only has AC 101).
    const s99 = await t.prisma.geographyNode.findFirstOrThrow({
      where: { type: 'state', code: 'S99' },
    });
    const seedAdmin = await t.prisma.appUser.findUniqueOrThrow({ where: { phone: AC_ADMIN } });
    const user = await t.prisma.appUser.create({
      data: { organizationId: seedAdmin.organizationId, name: 'State admin', phone: STATE_ADMIN },
    });
    await t.prisma.roleAssignment.create({
      data: { userId: user.id, role: 'admin', geographyNodeId: s99.id, grantedById: seedAdmin.id },
    });
    stateAdmin = await loginAs(t, STATE_ADMIN);
    acAdmin = await loginAs(t, AC_ADMIN);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('a volunteer gets 403', async () => {
    const volunteer = await loginAs(t, VOLUNTEER_A);
    await upload(volunteer, CSV, false, 403);
    await volunteer.http
      .post('/v1/geographies')
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'state', code: 'X', name: 'X' })
      .expect(403);
  });

  it('a preview writes nothing; confirming creates the tree and its closure rows', async () => {
    const preview = await upload(stateAdmin, CSV);
    expect(preview.applied).toBe(false);
    expect(actions(preview)).toEqual(['2:create', '3:create', '4:create', '5:create']);
    expect(preview.counts).toEqual({ create: 4, update: 0, unchanged: 0, error: 0 });
    expect(await nodes('S98')).toHaveLength(0);

    const done = await upload(stateAdmin, CSV, true);
    expect(done).toMatchObject({ applied: true, counts: { create: 4 } });
    const [state] = await nodes('S98');
    expect(state).toMatchObject({ type: 'state', name: 'Sample State', parentId: null });
    const pc = await t.prisma.geographyNode.findFirstOrThrow({
      where: { type: 'pc', code: '1', parentId: state!.id },
    });
    expect(pc.metadata).toEqual({ reservation: 'GEN' });
    const acs = await t.prisma.geographyNode.findMany({
      where: { parentId: pc.id },
      orderBy: { code: 'asc' },
    });
    expect(acs.map((a) => [a.type, a.code, a.name, a.metadata])).toEqual([
      ['ac', '11', 'Sample AC Eleven', { reservation: 'GEN' }],
      ['ac', '12', 'Sample AC Twelve', { reservation: 'SC' }],
    ]);
    // The closure: AC 12 sits below its PC and its State.
    const ancestors = await t.prisma.geographyClosure.findMany({
      where: { descendantId: acs[1]!.id },
      orderBy: { depth: 'asc' },
    });
    expect(ancestors.map((a) => [a.ancestorId, a.depth])).toEqual([
      [acs[1]!.id, 0],
      [pc.id, 1],
      [state!.id, 2],
    ]);
    const audit = await t.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'geography.import' },
      orderBy: { seq: 'desc' },
    });
    expect(audit).toMatchObject({
      resourceType: 'election_program',
      resourceId: done.programId,
      actorId: stateAdmin.userId,
      metadata: { created: 4, updated: 0, unchanged: 0 },
    });
  });

  it('uploading the same file again changes nothing', async () => {
    const before = await t.prisma.geographyNode.count();
    const again = await upload(stateAdmin, CSV, true);
    expect(again.counts).toEqual({ create: 0, update: 0, unchanged: 4, error: 0 });
    expect(await t.prisma.geographyNode.count()).toBe(before);
  });

  it('a changed name or reservation is an update; nothing is deleted', async () => {
    const csv = [
      'level,code,name,reservation,parent_code,state_code',
      'state,S98,Sample State,,,',
      'pc,1,Sample PC One (renamed),GEN,S98,',
      'ac,12,Sample AC Twelve,,1,S98', // reservation removed; AC 11 left out
    ].join('\n');
    const report = await upload(stateAdmin, csv, true);
    expect(actions(report)).toEqual(['2:unchanged', '3:update', '4:update']);
    const [state] = await nodes('S98');
    const pc = await t.prisma.geographyNode.findFirstOrThrow({
      where: { code: '1', parentId: state!.id },
    });
    expect(pc.name).toBe('Sample PC One (renamed)');
    const acs = await t.prisma.geographyNode.findMany({
      where: { parentId: pc.id },
      orderBy: { code: 'asc' },
    });
    expect(acs.map((a) => [a.code, a.metadata])).toEqual([
      ['11', { reservation: 'GEN' }],
      ['12', {}],
    ]);
  });

  it('an AC under an unknown PC is a row error, and confirming saves nothing', async () => {
    const csv = [
      'level,code,name,reservation,parent_code,state_code',
      'ac,13,New AC,,1,S98',
      'ac,77,Orphan AC,,77,S98',
      'pc,2,No such state,,S00,',
      'state,S98,Duplicate,,,',
      'state,S98,Again,,,',
      'district,5,Wrong level,,S98,',
      'ac,,,,1,S98',
    ].join('\n');
    const preview = await upload(stateAdmin, csv);
    expect(actions(preview)).toEqual([
      '2:create',
      '3:error(Unknown PC 77)',
      '4:error(Unknown State S00)',
      '5:update',
      '6:error(Same STATE as line 5)',
      '7:error(level must be state, pc or ac)',
      '8:error(code is required; name is required)',
    ]);
    const failed = await upload(stateAdmin, csv, true, 422);
    expect(failed.details!.counts.error).toBe(5);
    expect(await nodes('13')).toHaveLength(0);
    expect((await nodes('S98'))[0]!.name).toBe('Sample State');
  });

  it('two PCs with the same code need state_code', async () => {
    // PC 1 is in both S99 (seed) and S98.
    const csv = 'level,code,name,parent_code\nac,14,Which PC,1';
    expect(actions(await upload(stateAdmin, csv))).toEqual([
      '2:error(More than one PC has code 1; add state_code to say which)',
    ]);
    const fixed = await upload(
      stateAdmin,
      'level,code,name,parent_code,state_code\nac,14,Which PC,1,S99\nac,15,This PC,1,S98',
    );
    expect(fixed.rows.map((r) => r.action)).toEqual(['create', 'create']);
  });

  it('an AC admin changes only their own AC and cannot add States', async () => {
    const csv = [
      'level,code,name,reservation,parent_code,state_code',
      'state,S97,Another State,,,',
      'pc,1,Demo Parliamentary Constituency,GEN,S99,',
      'ac,101,Demo AC (renamed),GENERAL,1,S99',
      'ac,16,New AC in Demo PC,,1,S99',
    ].join('\n');
    expect(actions(await upload(acAdmin, csv))).toEqual([
      '2:error(Outside your area)',
      '3:error(Outside your area)',
      '4:update',
      '5:error(Outside your area)',
    ]);
    await acAdmin.http
      .post('/v1/geographies')
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'state', code: 'S97', name: 'Another State' })
      .expect(404);
  });

  it('a file that is not a master list is rejected as a whole', async () => {
    for (const [csv, message] of [
      ['level,code,name\nstate,S1,x', 'Missing column(s): parent_code'],
      ['level,code,name,parent_code,colour\nstate,S1,x,,red', 'Unknown column(s): colour'],
      ['level,code,name,parent_code', 'The file has no rows'],
      ['level,code,name,parent_code\nstate,"S1,x,', 'The CSV has a quote that is never closed'],
    ]) {
      const body = await upload(stateAdmin, csv!, false, 422);
      expect(body).toMatchObject({ message });
    }
  });

  describe('one node at a time', () => {
    it('adds a State, a PC under it and an AC under that, audited', async () => {
      const post = (body: object, status = 201) =>
        stateAdmin.http
          .post('/v1/geographies')
          .set('Idempotency-Key', randomUUID())
          .send(body)
          .expect(status)
          .then((res) => res.body as MasterNodeView);
      const state = await post({ type: 'state', code: 'S96', name: 'Single State' });
      const pc = await post({ type: 'pc', code: '3', name: 'Single PC', parentId: state.id });
      const ac = await post({
        type: 'ac',
        code: '31',
        name: 'Single AC',
        reservation: 'ST',
        parentId: pc.id,
      });
      expect(ac).toEqual({
        id: ac.id,
        parentId: pc.id,
        type: 'ac',
        code: '31',
        name: 'Single AC',
        reservation: 'ST',
      });
      expect(await t.prisma.geographyClosure.count({ where: { descendantId: ac.id } })).toBe(3);
      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'geography.create', resourceId: ac.id },
      });
      expect(audit).toMatchObject({
        actorId: stateAdmin.userId,
        metadata: { type: 'ac', parentId: pc.id },
      });

      // Wrong parent type, a missing parent, and a parent outside the area.
      await post({ type: 'ac', code: '32', name: 'x', parentId: state.id }, 422);
      await post({ type: 'pc', code: '4', name: 'x' }, 422);
      const ac101 = await t.prisma.geographyNode.findFirstOrThrow({
        where: { type: 'ac', code: '101' },
      });
      await acAdmin.http
        .post('/v1/geographies')
        .set('Idempotency-Key', randomUUID())
        .send({ type: 'ac', code: '33', name: 'x', parentId: pc.id })
        .expect(404);
      // Parts come from roll imports, not from here.
      await post({ type: 'part', code: '9', name: 'x', parentId: ac101.id }, 400);
    });

    it('renames a node or changes its reservation, audited with field names only', async () => {
      const ac101 = await t.prisma.geographyNode.findFirstOrThrow({
        where: { type: 'ac', code: '101' },
      });
      const patched = await acAdmin.http
        .patch(`/v1/geographies/${ac101.id}`)
        .set('Idempotency-Key', randomUUID())
        .send({ reservation: 'SC' })
        .expect(200)
        .then((res) => res.body as MasterNodeView);
      expect(patched).toMatchObject({ id: ac101.id, reservation: 'SC' });
      const cleared = await acAdmin.http
        .patch(`/v1/geographies/${ac101.id}`)
        .set('Idempotency-Key', randomUUID())
        .send({ name: 'Demo Assembly Constituency', reservation: null })
        .expect(200)
        .then((res) => res.body as MasterNodeView);
      expect(cleared).toMatchObject({ name: 'Demo Assembly Constituency', reservation: null });
      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'geography.update', resourceId: ac101.id },
        orderBy: { seq: 'desc' },
      });
      expect(audit.metadata).toEqual({ fields: ['name', 'reservation'] });

      await acAdmin.http
        .patch(`/v1/geographies/${ac101.id}`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(422);
      const [s98] = await nodes('S98');
      await acAdmin.http
        .patch(`/v1/geographies/${s98!.id}`)
        .set('Idempotency-Key', randomUUID())
        .send({ name: 'x' })
        .expect(404);
      await acAdmin.http
        .patch(`/v1/geographies/${ac101.id}`)
        .set('Idempotency-Key', randomUUID())
        .send({ code: '999' })
        .expect(400);
    });
  });
});
