import { createHash, randomUUID } from 'node:crypto';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import type { Prisma } from '../src/generated/prisma/client';
import type { BatchConfirmResult, ConfirmQueued } from '../src/imports/confirm.service';
import { ImportConfirmService } from '../src/imports/confirm.service';
import type { BatchView } from '../src/imports/imports.service';
import type { FilePreview } from '../src/imports/review.service';
import { NodeStatsRefresh } from '../src/analytics/stats-refresh';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Import files and rows here are made up (synthetic names and EPICs), as
// extraction and review (#45, #46) leave them; never real roll data. Seed:
// AC 101 has part 1 (stations 1 and auxiliary 1A covering section 2, one
// revision with 20 houses and 60 voters) and part 2; the admin is scoped to
// AC 101.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

type RowSeed = {
  serial: number;
  section?: number;
  house?: string | null;
  gender?: 'male' | 'female';
  epic?: string | null;
  marker?: 'deleted' | null;
  status?: 'accepted' | 'warning' | 'rejected';
  messages?: object[];
  corrected?: Record<string, unknown>;
};

class RecordingStats extends NodeStatsRefresh {
  readonly requests: string[][] = [];
  request(nodeIds: string[]): Promise<void> {
    this.requests.push(nodeIds);
    return Promise.resolve();
  }
}

describe('import confirm: committing reviewed files to the active dataset', () => {
  let t: TestApp;
  let admin: SignedIn;
  let confirm: ImportConfirmService;
  const stats = new RecordingStats();
  let epic = 7_000_000;

  const node = (type: 'ac' | 'part' | 'polling_station', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });

  const batchAt = async (targetNodeId: string) =>
    (
      (
        await admin.http
          .post('/v1/imports/batches')
          .set('Idempotency-Key', randomUUID())
          .send({ targetNodeId })
          .expect(201)
      ).body as BatchView
    ).id;

  /**
   * A file as extraction and review leave it, for part `partCode` of AC 101
   * (an existing part is linked; a new one is proposed), with stations
   * `<part>` and auxiliary `<part>A`. Printed totals follow the rows unless
   * `printed` is given.
   */
  const seedFile = async (
    batchId: string,
    partCode: string,
    rows: RowSeed[],
    options: {
      status?: 'ready' | 'needs_review';
      printed?: { male: number; female: number; thirdGender: number; total: number };
      acNumber?: number;
    } = {},
  ) => {
    const batch = await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    const part = await t.prisma.geographyNode.findFirst({
      where: { type: 'part', code: partCode },
    });
    const id = randomUUID();
    const counted = rows.filter((r) => r.status !== 'rejected' && r.marker !== 'deleted');
    const counts = {
      male: counted.filter((r) => (r.gender ?? 'male') === 'male').length,
      female: counted.filter((r) => r.gender === 'female').length,
      thirdGender: 0,
      total: counted.length,
    };
    const station = (code: string, auxiliary: boolean) => ({
      code,
      name: `Synthetic School ${code}`,
      auxiliary,
      nodeId: null,
    });
    await t.prisma.importFile.create({
      data: {
        id,
        batchId,
        programId: batch.programId,
        fileRef: `imports/${batchId}/${id}.pdf`,
        originalName: `synthetic-part-${partCode}.pdf`,
        sizeBytes: 1000,
        checksum: createHash('sha256').update(id).digest('hex'),
        status: options.status ?? 'ready',
        pageCount: 4,
        partNodeId: part?.id ?? null,
        extractionMethod: 'ocr',
        qualityScore: 0.9,
        printedTotals: {
          startSerial: 1,
          endSerial: rows.length,
          counts: options.printed ?? counts,
        },
        extractedTotals: counts,
        detectedHeader: {
          header: {
            stateCode: 'S99',
            acNumber: options.acNumber ?? 101,
            partNumber: Number(partCode),
            revisionYear: 2027,
            revisionType: 'Synthetic Revision 2027',
            mainTown: `Synthetic Town ${partCode}`,
            pollingStation: {
              number: partCode,
              name: `Synthetic School ${partCode}`,
              address: 'Synthetic address',
            },
            auxiliaryStations: [
              { number: `${partCode}A`, name: 'Synthetic Annexe', address: 'Synthetic address' },
            ],
          },
          matching: {
            partNodeId: part?.id ?? null,
            proposedPart: part ? null : { code: partCode, name: `Synthetic Town ${partCode}` },
            stations: [station(partCode, false), station(`${partCode}A`, true)],
            previousSourceVersionId: null,
          },
          issues: [],
          pageImages: [],
        },
        extractedAt: new Date(),
      },
    });
    const data: Prisma.ImportRowResultCreateManyInput[] = rows.map((r, i) => ({
      importFileId: id,
      page: 3 + Math.floor(i / 30),
      boxIndex: i % 30,
      sectionNo: r.section ?? 1,
      serialNo: r.serial,
      status: r.status ?? (r.messages?.length ? 'warning' : 'accepted'),
      messages: r.messages ?? [],
      rawText: `${r.serial} synthetic`,
      extractedValues: {
        epic: r.epic === undefined ? `TST${(epic += 1)}` : r.epic,
        name: `Synthetic Person ${r.serial}`,
        relationType: 'father',
        relativeName: `Synthetic Relative ${r.serial}`,
        houseNumber: r.house === undefined ? `${r.serial}` : r.house,
        age: 30 + (r.serial % 40),
        gender: r.gender ?? 'male',
        printedSerial: r.serial,
        marker: r.marker ?? null,
      },
      fieldConfidence: { epic: 0.95, name: 0.9 },
      correctedValues: (r.corrected as Prisma.InputJsonValue) ?? undefined,
    }));
    await t.prisma.importRowResult.createMany({ data });
    return id;
  };

  const confirmFile = (id: string, body: object = {}, who: SignedIn = admin) =>
    who.http.post(`/v1/imports/files/${id}/confirm`).send(body);

  beforeAll(async () => {
    t = await createTestApp((builder) =>
      builder.overrideProvider(NodeStatsRefresh).useValue(stats),
    );
    confirm = t.app.get(ImportConfirmService);
    admin = await loginAs(t, ADMIN);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('a new part: nothing is live before confirm; after it, part, stations, households and voters are', async () => {
    const ac = await node('ac', '101');
    const batchId = await batchAt(ac.id);
    const fileId = await seedFile(batchId, '7', [
      { serial: 1, house: 'H NO 5-1' },
      { serial: 2, house: '5-1', gender: 'female', corrected: { name: 'Corrected Name' } },
      { serial: 3, house: 'h.no. 5 - 1' },
      { serial: 4, house: null, gender: 'female' },
      { serial: 5, house: '9', status: 'rejected' },
      { serial: 6, house: '9', marker: 'deleted' },
      { serial: 7, house: '9', section: 2 },
    ]);

    // Extraction and review leave nothing in the active set.
    expect(await t.prisma.geographyNode.count({ where: { type: 'part', code: '7' } })).toBe(0);
    expect(await t.prisma.voter.count({ where: { importFileId: fileId } })).toBe(0);

    // The preview says what confirm will commit: 5 voters in 3 households.
    const preview = (await admin.http.get(`/v1/imports/files/${fileId}/preview`).expect(200))
      .body as FilePreview;
    expect(preview.willCommit).toEqual({ voters: 5, households: 3 });

    const queued = (await confirmFile(fileId).expect(202)).body as ConfirmQueued;
    expect(queued).toEqual({ id: fileId, status: 'confirming', voters: 5 });
    await confirm.drain();

    const part = await t.prisma.geographyNode.findFirstOrThrow({
      where: { type: 'part', code: '7', parentId: ac.id },
      include: { children: { orderBy: { code: 'asc' } } },
    });
    expect(part.name).toBe('Synthetic Town 7');
    expect(part.children.map((c) => [c.code, c.isAuxiliary])).toEqual([
      ['7', false],
      ['7A', true],
    ]);
    const main = part.children[0]!;
    const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file).toMatchObject({
      status: 'confirmed',
      partNodeId: part.id,
      confirmedById: admin.userId,
    });
    const version = await t.prisma.sourceVersion.findUniqueOrThrow({
      where: { id: file.sourceVersionId! },
    });
    expect(version).toMatchObject({
      partNodeId: part.id,
      revisionYear: 2027,
      revisionType: 'Synthetic Revision 2027',
      checksum: file.checksum,
      previousVersionId: null,
    });

    const voters = await t.prisma.voter.findMany({
      where: { importFileId: fileId },
      include: { household: true },
      orderBy: { serialNo: 'asc' },
    });
    // Rejected and deleted rows aren't imported; everyone is at the main station
    // (7A has no coverage yet).
    expect(voters.map((v) => v.serialNo)).toEqual([1, 2, 3, 4, 7]);
    expect(voters.every((v) => v.pollingStationId === main.id && v.recordStatus === 'active')).toBe(
      true,
    );
    expect(voters.every((v) => v.origin === 'official_import' && v.partId === part.id)).toBe(true);
    // Corrections are applied to the official record.
    expect(voters[1]!.sourceData).toMatchObject({ name: 'Corrected Name', corrected: ['name'] });
    expect(voters[0]!.sourceData).toMatchObject({ name: 'Synthetic Person 1', corrected: [] });
    // Households by house number: three spellings of 5-1 are one house.
    const byHouse = new Map(voters.map((v) => [v.serialNo, v.household]));
    expect(byHouse.get(1)!.id).toBe(byHouse.get(2)!.id);
    expect(byHouse.get(1)!.id).toBe(byHouse.get(3)!.id);
    expect(byHouse.get(1)).toMatchObject({ houseKey: '5-1', displayAddress: 'H NO 5-1' });
    expect(byHouse.get(4)!.houseKey).toBe('~1-4');
    expect(byHouse.get(7)!.houseKey).toBe('9');
    expect(await t.prisma.household.count({ where: { partId: part.id } })).toBe(3);

    const batch = await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('completed');
    const audit = await t.prisma.auditEvent.findMany({
      where: { resourceId: fileId, action: { startsWith: 'import.file.' } },
      orderBy: { seq: 'asc' },
    });
    expect(audit.map((a) => [a.action, a.result, a.actorId])).toEqual([
      ['import.file.confirm', 'success', admin.userId],
      ['import.file.committed', 'success', null],
    ]);
    expect(audit[1]!.metadata).toMatchObject({
      voters: 5,
      householdsCreated: 3,
      partCreated: true,
      stationsCreated: 2,
      rowsRejected: 1,
      rowsDeleted: 1,
    });
    expect(JSON.stringify(audit[1]!.metadata)).not.toContain('Synthetic Person');
    expect(stats.requests.at(-1)).toEqual([part.id, main.id]);
  });

  it('confirming twice is rejected', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const fileId = await seedFile(batchId, '8', [{ serial: 1 }, { serial: 2 }]);
    await confirmFile(fileId).expect(202);
    const again = (await confirmFile(fileId).expect(409)).body as ApiErrorBody;
    expect(again.details).toMatchObject({ reason: 'file.already_confirmed' });
    // Several workers at once (e.g. two API instances) commit it once.
    await Promise.all([confirm.commitNext(), confirm.commitNext(), confirm.drain()]);
    expect((await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } })).status).toBe(
      'confirmed',
    );
    await confirmFile(fileId).expect(409);
    expect(await t.prisma.voter.count({ where: { importFileId: fileId } })).toBe(2);
    expect(
      await t.prisma.sourceVersion.count({
        where: {
          checksum: (await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } }))
            .checksum,
        },
      }),
    ).toBe(1);
  });

  it('a file with unresolved rows or a totals mismatch waits for review', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const fileId = await seedFile(
      batchId,
      '9',
      [
        { serial: 1 },
        {
          serial: 2,
          messages: [
            { code: 'field.missing', severity: 'error', message: 'age', field: 'rows[2].age' },
          ],
        },
      ],
      { status: 'needs_review' },
    );
    const [, errorRow] = await t.prisma.importRowResult.findMany({
      where: { importFileId: fileId },
      orderBy: { serialNo: 'asc' },
    });
    const unresolved = (await confirmFile(fileId).expect(422)).body as ApiErrorBody;
    expect(unresolved.details).toMatchObject({ reason: 'rows.unresolved', rowIds: [errorRow!.id] });

    // Rejecting the row resolves it, but then the totals no longer match.
    await admin.http
      .patch(`/v1/imports/files/${fileId}/rows/${errorRow!.id}`)
      .send({ rejected: true })
      .expect(200);
    const mismatch = (await confirmFile(fileId).expect(422)).body as ApiErrorBody;
    expect(mismatch.details).toMatchObject({
      reason: 'totals.mismatch',
      printed: { total: 2 },
      current: { total: 1 },
    });
    // The admin checked why, and confirms anyway.
    await confirmFile(fileId, { acceptTotalsMismatch: true }).expect(202);
    await confirm.drain();
    expect(await t.prisma.voter.count({ where: { importFileId: fileId } })).toBe(1);
    const event = await t.prisma.auditEvent.findFirstOrThrow({
      where: { resourceId: fileId, action: 'import.file.confirm' },
    });
    expect(event.metadata).toEqual({ voters: 1, acceptTotalsMismatch: true });
  });

  it('a commit that fails goes back to review with the reason', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    // An AC that isn't in the master data (extraction would normally have rejected it).
    const fileId = await seedFile(batchId, '11', [{ serial: 1 }], { acNumber: 999 });
    await confirmFile(fileId).expect(202);
    await confirm.drain();
    const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file).toMatchObject({
      status: 'needs_review',
      confirmedAt: null,
      error: { code: 'header.ac_unknown' },
    });
    expect(await t.prisma.geographyNode.count({ where: { type: 'part', code: '11' } })).toBe(0);
    const failed = await t.prisma.auditEvent.findFirstOrThrow({
      where: { resourceId: fileId, action: 'import.file.committed' },
    });
    expect(failed.result).toBe('failure');
  });

  it('a batch confirms every ready file and reports the ones it skipped', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const a = await seedFile(batchId, '12', [{ serial: 1 }]);
    const b = await seedFile(batchId, '13', [
      { serial: 1, epic: 'DUP0000001' },
      { serial: 2, epic: 'DUP0000001' },
    ]);
    const review = await seedFile(batchId, '14', [{ serial: 1 }], { status: 'needs_review' });

    const res = (await admin.http.post(`/v1/imports/batches/${batchId}/confirm`).expect(202))
      .body as BatchConfirmResult;
    expect(res.queued.map((q) => q.id)).toEqual([a]);
    expect(res.skipped).toEqual([
      { id: b, code: 'rows.duplicate_epic', message: expect.any(String) },
    ]);
    await confirm.drain();
    const statuses = await t.prisma.importFile.findMany({
      where: { id: { in: [a, b, review] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [a]: 'confirmed',
      [b]: 'ready',
      [review]: 'needs_review',
    });
    expect(await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).toMatchObject({
      status: 'review',
      confirmedById: admin.userId,
    });

    const empty = await batchAt((await node('ac', '101')).id);
    await admin.http.post(`/v1/imports/batches/${empty}/confirm`).expect(422);
  });

  it('volunteers get 403; another area or an unknown file gets 404', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const fileId = await seedFile(batchId, '15', [{ serial: 1 }]);
    const volunteer = await loginAs(t, VOLUNTEER_A);
    await confirmFile(fileId, {}, volunteer).expect(403);
    await volunteer.http.post(`/v1/imports/batches/${batchId}/confirm`).expect(403);
    await confirmFile(randomUUID()).expect(404);
    await admin.http.post(`/v1/imports/batches/${randomUUID()}/confirm`).expect(404);

    const ac = await node('ac', '101');
    const other = await t.prisma.geographyNode.create({
      data: {
        programId: ac.programId,
        parentId: ac.parentId,
        type: 'ac',
        code: '120',
        name: 'Elsewhere',
      },
    });
    const outside = await t.prisma.importBatch.create({
      data: { programId: ac.programId, targetNodeId: other.id, uploadedById: admin.userId },
    });
    await admin.http.post(`/v1/imports/batches/${outside.id}/confirm`).expect(404);
  });

  // Last: it replaces the seed's revision of part 1.
  it('a new revision of a part keeps the previous one, and links or removes its households', async () => {
    const part = await node('part', '1');
    const [station1, station1a] = await Promise.all([
      node('polling_station', '1'),
      node('polling_station', '1A'),
    ]);
    const previous = await t.prisma.sourceVersion.findFirstOrThrow({
      where: { partNodeId: part.id },
    });
    const before = await t.prisma.voter.count({
      where: { partId: part.id, recordStatus: 'active', origin: 'official_import' },
    });
    const kept = await t.prisma.household.findFirstOrThrow({
      where: { partId: part.id, houseKey: '1-3' },
    });
    const volunteerHouse = await t.prisma.household.create({
      data: {
        partId: part.id,
        pollingStationId: station1.id,
        houseKey: 'V-1',
        displayAddress: 'Added by a volunteer',
        origin: 'volunteer_added',
      },
    });

    const batchId = await batchAt(part.id);
    const fileId = await seedFile(batchId, '1', [
      { serial: 1, house: 'H NO 1-3' },
      { serial: 2, house: 'H NO 1-3', gender: 'female' },
      { serial: 3, house: 'H NO 1-99', section: 2 },
    ]);
    // Two households: one linked (1-3), one created (1-99).
    const preview = (await admin.http.get(`/v1/imports/files/${fileId}/preview`).expect(200))
      .body as FilePreview;
    expect(preview.willCommit).toEqual({ voters: 3, households: 2 });
    await confirmFile(fileId).expect(202);
    await confirm.drain();

    const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } });
    const versions = await t.prisma.sourceVersion.findMany({
      where: { partNodeId: part.id },
      orderBy: { createdAt: 'asc' },
    });
    // Both revisions are kept, chained.
    expect(versions.map((v) => v.id)).toEqual([previous.id, file.sourceVersionId]);
    expect(versions[1]!.previousVersionId).toBe(previous.id);
    // The previous revision's voters stay, superseded; the new ones are active.
    expect(
      await t.prisma.voter.count({
        where: { sourceVersionId: previous.id, recordStatus: 'superseded' },
      }),
    ).toBe(before);
    const active = await t.prisma.voter.findMany({
      where: { partId: part.id, recordStatus: 'active', origin: 'official_import' },
      orderBy: { serialNo: 'asc' },
    });
    expect(active.map((v) => v.importFileId)).toEqual([fileId, fileId, fileId]);
    // Members volunteers added aren't on the roll, so no revision supersedes them.
    expect(
      await t.prisma.voter.count({
        where: { partId: part.id, origin: 'volunteer_added', recordStatus: 'superseded' },
      }),
    ).toBe(0);
    // Section 2 is covered by auxiliary station 1A (seed coverage).
    expect(active.map((v) => v.pollingStationId)).toEqual([station1.id, station1.id, station1a.id]);
    // House 1-3 is the same household, now on the new revision; houses the
    // new revision doesn't list are removed, but not volunteer-added ones.
    expect(active[0]!.householdId).toBe(kept.id);
    const households = await t.prisma.household.findMany({ where: { partId: part.id } });
    const byKey = new Map(households.map((h) => [h.houseKey, h]));
    expect(byKey.get('1-3')).toMatchObject({
      status: 'active',
      sourceVersionId: file.sourceVersionId,
    });
    expect(byKey.get('1-99')).toMatchObject({ status: 'active', pollingStationId: station1a.id });
    expect(byKey.get('1-6')!.status).toBe('removed');
    expect(byKey.get('V-1')).toMatchObject({
      id: volunteerHouse.id,
      status: 'active',
      origin: 'volunteer_added',
    });
    const committed = await t.prisma.auditEvent.findFirstOrThrow({
      where: { resourceId: fileId, action: 'import.file.committed' },
    });
    expect(committed.metadata).toMatchObject({
      previousVersionId: previous.id,
      votersSuperseded: before,
      householdsLinked: 1,
      householdsCreated: 1,
      householdsRemoved: 19,
      partCreated: false,
      stationsCreated: 0,
    });
  });
});
