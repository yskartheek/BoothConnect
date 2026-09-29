import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { Prisma } from '../src/generated/prisma/client';
import type { BatchView } from '../src/imports/imports.service';
import type { BatchDetail, FilePreview, ReviewRow } from '../src/imports/review.service';
import { StorageService } from '../src/imports/storage.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';

// Needs MinIO as well as Postgres and Redis: `pnpm infra:up`. The import files
// and rows here are made up (synthetic names and EPICs), as the roll-parser
// would have stored them (#45); never real roll data.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';
/** A few bytes that start like a JPEG; enough to check the bytes come back. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from('synthetic page image')]);

describe('import review: batch status, preview, page images, row corrections', () => {
  let t: TestApp;
  let admin: SignedIn;
  let storage: StorageService;
  let tmp: string;

  const node = (type: 'ac' | 'part', code: string) =>
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

  const putImage = async (key: string) => {
    const path = join(tmp, randomUUID());
    await writeFile(path, JPEG);
    await storage.writeFile(key, path, JPEG.length, 'image/jpeg');
  };

  type RowSeed = {
    page: number;
    boxIndex: number;
    gender: string | null;
    marker?: 'deleted' | null;
    epic?: string;
    messages?: object[];
    confidence?: Record<string, number>;
  };
  const row = (
    seed: RowSeed,
    i: number,
  ): Omit<Prisma.ImportRowResultCreateManyInput, 'importFileId'> => ({
    page: seed.page,
    boxIndex: seed.boxIndex,
    sectionNo: 1,
    serialNo: i + 1,
    status: seed.messages?.length ? 'warning' : 'accepted',
    messages: seed.messages ?? [],
    rawText: `${i + 1} synthetic`,
    extractedValues: {
      epic: seed.epic ?? `TST${String(1_000_000 + i)}`,
      name: `Synthetic Person ${i + 1}`,
      relationType: 'father',
      relativeName: `Synthetic Relative ${i + 1}`,
      houseNumber: `${i + 1}`,
      age: 30 + i,
      gender: seed.gender,
      printedSerial: i + 1,
      marker: seed.marker ?? null,
    },
    fieldConfidence: {
      epic: 0.95,
      name: 0.9,
      relationType: 0.95,
      relativeName: 0.9,
      houseNumber: 0.9,
      age: 0.95,
      gender: 0.9,
      printedSerial: 0.95,
      ...seed.confidence,
    },
  });

  /**
   * A file as extraction leaves it: printed totals 2 men, 1 woman, 3 in all.
   * Row 3's gender wasn't read (an error), row 2's name is low-confidence and
   * row 4 is marked deleted, so the totals don't match yet: needs_review.
   */
  const seedFile = async (
    batchId: string,
    status: 'needs_review' | 'failed' = 'needs_review',
    withPart = status !== 'failed',
  ) => {
    const [batch, part] = await Promise.all([
      t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } }),
      node('part', '1'),
    ]);
    const id = randomUUID();
    const pages = [
      { page: 1, kind: 'cover', key: `extractions/${id}/pages/1.jpg`, width: 10, height: 10 },
      { page: 2, kind: 'maps', key: `extractions/${id}/pages/2.jpg`, width: 10, height: 10 },
      { page: 3, kind: 'voters', key: `extractions/${id}/pages/3.jpg`, width: 1984, height: 2807 },
      { page: 4, kind: 'voters', key: `extractions/${id}/pages/4.jpg`, width: 1984, height: 2807 },
    ];
    for (const p of pages) await putImage(p.key);
    await t.prisma.importFile.create({
      data: {
        id,
        batchId,
        programId: batch.programId,
        fileRef: `imports/${batchId}/${id}.pdf`,
        originalName: 'synthetic-part-1.pdf',
        sizeBytes: 1234,
        checksum: createHash('sha256').update(id).digest('hex'),
        status,
        pageCount: 5,
        partNodeId: withPart ? part.id : null,
        extractionMethod: 'ocr',
        qualityScore: 0.82,
        printedTotals: {
          startSerial: 1,
          endSerial: 4,
          counts: { male: 2, female: 1, thirdGender: 0, total: 3 },
        },
        extractedTotals: { male: 1, female: 1, thirdGender: 0, total: 3 },
        detectedHeader: {
          header: { stateCode: 'S99', acNumber: 101, partNumber: 1, revisionYear: 2026 },
          matching: {
            partNodeId: part.id,
            proposedPart: null,
            stations: [{ code: '1', name: 'Synthetic School 1', auxiliary: false, nodeId: null }],
            previousSourceVersionId: null,
          },
          issues: [
            { code: 'totals.extracted_mismatch', severity: 'error', message: 'Totals differ' },
          ],
          pageImages: pages,
        },
        error:
          status === 'failed' ? { code: 'extraction_failed', message: 'Try again' } : undefined,
        extractedAt: new Date(),
      },
    });
    const seeds: RowSeed[] = [
      { page: 3, boxIndex: 0, gender: 'male' },
      {
        page: 3,
        boxIndex: 1,
        gender: 'female',
        confidence: { name: 0.4 },
        messages: [
          {
            code: 'field.low_confidence',
            severity: 'warning',
            message: 'name read with low confidence (0.40)',
            field: 'rows[2].name',
          },
        ],
      },
      {
        page: 3,
        boxIndex: 2,
        gender: null,
        messages: [
          {
            code: 'field.missing',
            severity: 'error',
            message: 'gender not found or unreadable',
            field: 'rows[3].gender',
          },
        ],
      },
      { page: 4, boxIndex: 0, gender: 'female', marker: 'deleted' },
    ];
    await t.prisma.importRowResult.createMany({
      data: seeds.map((s, i) => ({ ...row(s, i), importFileId: id })),
    });
    const rows = await t.prisma.importRowResult.findMany({
      where: { importFileId: id },
      orderBy: [{ page: 'asc' }, { boxIndex: 'asc' }],
    });
    return { id, rows: rows.map((r) => r.id) };
  };

  const preview = (fileId: string, query = '', who: SignedIn = admin) =>
    who.http.get(`/v1/imports/files/${fileId}/preview${query}`);
  const correct = (fileId: string, rowId: string, body: object) =>
    admin.http.patch(`/v1/imports/files/${fileId}/rows/${rowId}`).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    storage = t.app.get(StorageService);
    await storage.ensureBucket();
    admin = await loginAs(t, ADMIN);
    tmp = await mkdtemp(join(tmpdir(), 'import-review-'));
  });

  afterAll(async () => {
    await t?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  describe('GET /v1/imports/batches/:id', () => {
    it('lists every file with its status, part, page and voter counts and quality', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const good = await seedFile(batchId);
      const failed = await seedFile(batchId, 'failed');
      const part = await node('part', '1');

      const body = (await admin.http.get(`/v1/imports/batches/${batchId}`).expect(200))
        .body as BatchDetail;
      expect(body).toMatchObject({ id: batchId, statusCounts: { needs_review: 1, failed: 1 } });
      const file = body.files.find((f) => f.id === good.id)!;
      expect(file).toMatchObject({
        status: 'needs_review',
        part: { id: part.id, code: '1' },
        proposedPart: null,
        pageCount: 5,
        qualityScore: 0.82,
        rowCount: 4,
        rows: { accepted: 2, warning: 2, rejected: 0 },
        // The entry marked deleted isn't a voter.
        voterCount: 3,
        error: null,
      });
      // The counts are the row results'.
      const stored = await t.prisma.importRowResult.groupBy({
        by: ['status'],
        where: { importFileId: good.id },
        _count: { _all: true },
      });
      expect(Object.fromEntries(stored.map((s) => [s.status, s._count._all]))).toEqual({
        accepted: 2,
        warning: 2,
      });
      expect(body.files.find((f) => f.id === failed.id)).toMatchObject({
        status: 'failed',
        part: null,
        error: { code: 'extraction_failed' },
      });
    });

    it('says whether each file’s voters match the printed totals, as the rows are corrected', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const file = await seedFile(batchId);
      const unread = await seedFile(batchId);
      await t.prisma.importFile.update({
        where: { id: unread.id },
        data: { printedTotals: Prisma.DbNull },
      });
      const batch = async () =>
        (await admin.http.get(`/v1/imports/batches/${batchId}`).expect(200)).body as BatchDetail;
      const totalsOf = async (id: string) => (await batch()).files.find((f) => f.id === id)!;

      // Printed: 2 men, 1 woman. Read: 1 man, 1 woman, one gender missing.
      expect(await totalsOf(file.id)).toMatchObject({ totalsMatch: false, voterCount: 3 });
      // Printed totals unreadable: no check.
      expect((await totalsOf(unread.id)).totalsMatch).toBeNull();

      // A row with an error: confirm would refuse, so nothing to commit yet.
      expect(((await preview(file.id)).body as FilePreview).willCommit).toBeNull();

      // Correct the missing gender: the totals match, as in the preview.
      await correct(file.id, file.rows[2]!, { values: { gender: 'male' } }).expect(200);
      // Three voters, each at their own house number; the deleted entry isn't one.
      expect(((await preview(file.id)).body as FilePreview).willCommit).toEqual({
        voters: 3,
        households: 3,
      });
      // Two of them at the same house: one household.
      await correct(file.id, file.rows[1]!, { values: { houseNumber: '1' } }).expect(200);
      expect(((await preview(file.id)).body as FilePreview).willCommit).toEqual({
        voters: 3,
        households: 2,
      });
      expect(await totalsOf(file.id)).toMatchObject({ totalsMatch: true, voterCount: 3 });
      expect(((await preview(file.id)).body as FilePreview).totals.matches).toBe(true);

      // A rejected row, and an entry un-deleted by a correction, count as the preview does.
      await correct(file.id, file.rows[0]!, { rejected: true, reason: 'Unreadable' }).expect(200);
      await correct(file.id, file.rows[3]!, { values: { marker: null } }).expect(200);
      const after = await totalsOf(file.id);
      const totals = ((await preview(file.id)).body as FilePreview).totals;
      expect(after.totalsMatch).toBe(totals.matches);
      expect(after.voterCount).toBe(totals.current.total);
      expect(totals.current).toEqual({ male: 1, female: 2, thirdGender: 0, total: 3 });
      expect(after.totalsMatch).toBe(false);

      // Printed totals equal to those counts: a match, which a rejected man
      // or a deleted entry counted by mistake would break.
      await t.prisma.importFile.update({
        where: { id: file.id },
        data: {
          printedTotals: { counts: { male: 1, female: 2, thirdGender: 0, total: 3 } },
        },
      });
      expect((await totalsOf(file.id)).totalsMatch).toBe(true);
    });

    it('404 for an unknown batch, 403 for a volunteer', async () => {
      await admin.http.get(`/v1/imports/batches/${randomUUID()}`).expect(404);
      const batchId = await batchAt((await node('ac', '101')).id);
      const volunteer = await loginAs(t, VOLUNTEER_A);
      await volunteer.http.get(`/v1/imports/batches/${batchId}`).expect(403);
    });
  });

  describe('GET /v1/imports/files/:id/preview', () => {
    it('shows the header, stations, voter pages and the totals check', async () => {
      const { id } = await seedFile(await batchAt((await node('ac', '101')).id));
      const body = (await preview(id).expect(200)).body as FilePreview;
      expect(body.header).toMatchObject({ stateCode: 'S99', acNumber: 101, partNumber: 1 });
      expect(body.stations).toEqual([
        { code: '1', name: 'Synthetic School 1', auxiliary: false, nodeId: null },
      ]);
      expect(body.issues.map((i) => i.code)).toEqual(['totals.extracted_mismatch']);
      // Voter pages only: the cover and the maps page are never offered.
      expect(body.pages.map((p) => p.page)).toEqual([3, 4]);
      expect(body.totals).toEqual({
        printed: { male: 2, female: 1, thirdGender: 0, total: 3 },
        extracted: { male: 1, female: 1, thirdGender: 0, total: 3 },
        current: { male: 1, female: 1, thirdGender: 0, total: 3 },
        difference: { male: -1, female: 0, thirdGender: 0, total: 0 },
        matches: false,
      });
      expect(body.rows.total).toBe(4);
      const first = body.rows.items[0]!;
      expect(first).toMatchObject({ page: 3, boxIndex: 0, status: 'accepted', corrected: null });
      expect(first.extracted).toMatchObject({ gender: 'male', sectionNumber: 1 });
      // Field names are normalised in messages.
      expect(body.rows.items[2]!.messages[0]).toMatchObject({
        code: 'field.missing',
        field: 'gender',
      });
    });

    it('pages through rows in roll order, and filters by status and low confidence', async () => {
      const { id, rows } = await seedFile(await batchAt((await node('ac', '101')).id));
      const one = (await preview(id, '?limit=3').expect(200)).body as FilePreview;
      expect(one.rows.items.map((r) => r.id)).toEqual(rows.slice(0, 3));
      expect(one.rows.total).toBe(4);
      const cursor = encodeURIComponent(one.rows.nextCursor!);
      const two = (await preview(id, `?limit=3&cursor=${cursor}`).expect(200)).body as FilePreview;
      expect(two.rows.items.map((r) => r.id)).toEqual(rows.slice(3));
      expect(two.rows.nextCursor).toBeNull();

      const warnings = (await preview(id, '?status=warning').expect(200)).body as FilePreview;
      expect(warnings.rows.items.map((r) => r.id)).toEqual([rows[1], rows[2]]);
      expect(warnings.rows.total).toBe(2);
      const both = (await preview(id, '?status=accepted,warning&limit=1').expect(200))
        .body as FilePreview;
      expect(both.rows.total).toBe(4);
      const low = (await preview(id, '?lowConfidence=true').expect(200)).body as FilePreview;
      expect(low.rows.items.map((r) => r.id)).toEqual([rows[1]]);
      const lowAccepted = (await preview(id, '?lowConfidence=true&status=accepted').expect(200))
        .body as FilePreview;
      expect(lowAccepted.rows.total).toBe(0);

      // Once the name is corrected, a person has checked it: no longer low confidence.
      await correct(id, rows[1]!, { values: { name: 'Synthetic Person Two' } }).expect(200);
      const after = (await preview(id, '?lowConfidence=true').expect(200)).body as FilePreview;
      expect(after.rows.total).toBe(0);

      const bad = (await preview(id, '?status=pending').expect(400)).body as ApiErrorBody;
      expect(bad.code).toBe('VALIDATION_FAILED');
      await preview(id, '?cursor=nonsense').expect(400);
    });

    it('404 for a file outside the admin’s area or unknown; 403 for a volunteer', async () => {
      const { id } = await seedFile(await batchAt((await node('ac', '101')).id));
      await preview(randomUUID()).expect(404);
      const volunteer = await loginAs(t, VOLUNTEER_A);
      await preview(id, '', volunteer).expect(403);
      // Another AC's batch.
      const ac = await node('ac', '101');
      const other = await t.prisma.geographyNode.create({
        data: {
          programId: ac.programId,
          parentId: ac.parentId,
          type: 'ac',
          code: '109',
          name: 'Elsewhere',
        },
      });
      const outside = await t.prisma.importBatch.create({
        data: { programId: ac.programId, targetNodeId: other.id, uploadedById: admin.userId },
      });
      const hidden = await seedFile(outside.id, 'needs_review', false);
      await preview(hidden.id).expect(404);
      await admin.http.get(`/v1/imports/batches/${outside.id}`).expect(404);
      await admin.http.get(`/v1/imports/files/${hidden.id}/pages/3`).expect(404);
      await correct(hidden.id, hidden.rows[0]!, { rejected: true }).expect(404);
    });
  });

  describe('GET /v1/imports/files/:id/pages/:n', () => {
    it('serves a voter page, never cached; cover, maps and unknown pages are 404', async () => {
      const { id } = await seedFile(await batchAt((await node('ac', '101')).id));
      const res = await admin.http
        .get(`/v1/imports/files/${id}/pages/3`)
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(res.body as Buffer, JPEG)).toBe(0);
      for (const page of [1, 2, 5]) {
        await admin.http.get(`/v1/imports/files/${id}/pages/${page}`).expect(404);
      }
      await admin.http.get(`/v1/imports/files/${id}/pages/three`).expect(400);
    });

    it('only serves objects written for that file', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const [mine, theirs] = [await seedFile(batchId), await seedFile(batchId)];
      const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id: mine.id } });
      const header = file.detectedHeader as { pageImages: { page: number; key: string }[] };
      header.pageImages = header.pageImages.map((p) =>
        p.page === 3 ? { ...p, key: `extractions/${theirs.id}/pages/3.jpg` } : p,
      );
      await t.prisma.importFile.update({
        where: { id: mine.id },
        data: { detectedHeader: header },
      });
      await admin.http.get(`/v1/imports/files/${mine.id}/pages/3`).expect(404);
      await admin.http.get(`/v1/imports/files/${theirs.id}/pages/3`).expect(200);
    });

    it('a volunteer can’t read page images', async () => {
      const { id } = await seedFile(await batchAt((await node('ac', '101')).id));
      const volunteer = await loginAs(t, VOLUNTEER_A);
      await volunteer.http.get(`/v1/imports/files/${id}/pages/3`).expect(403);
    });
  });

  describe('PATCH /v1/imports/files/:id/rows/:rowId', () => {
    it('a correction is stored next to the extracted value, audited, and re-checked', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const { id, rows } = await seedFile(batchId);
      const res = await correct(id, rows[2]!, { values: { gender: 'male' } }).expect(200);
      const corrected = res.body as ReviewRow;
      expect(corrected).toMatchObject({
        status: 'accepted',
        extracted: { gender: null },
        corrected: { gender: 'male' },
        current: { gender: 'male' },
        correctedBy: { id: admin.userId },
      });
      expect(corrected.correctedAt).toEqual(expect.any(String));
      expect(corrected.messages).toEqual([
        expect.objectContaining({ code: 'field.missing', field: 'gender', resolved: true }),
      ]);
      const stored = await t.prisma.importRowResult.findUniqueOrThrow({ where: { id: rows[2]! } });
      expect(stored.extractedValues).toMatchObject({ gender: null });
      expect(stored.correctedValues).toEqual({ gender: 'male' });
      expect(stored.correctedById).toBe(admin.userId);

      // The totals now match and no error is left: the file is ready.
      const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id } });
      expect(file.status).toBe('ready');
      const body = (await preview(id).expect(200)).body as FilePreview;
      expect(body.totals).toMatchObject({ matches: true, current: { male: 2, total: 3 } });

      const events = await t.prisma.auditEvent.findMany({
        where: { action: 'import.row.correct', resourceId: rows[2]! },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorId: admin.userId, result: 'success' });
      // Field names only; never the values.
      expect(events[0]!.metadata).toEqual({ importFileId: id, fields: ['gender'] });
    });

    it('rejecting a row takes it out of the counts; un-rejecting brings it back', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const { id, rows } = await seedFile(batchId);
      await correct(id, rows[2]!, { values: { gender: 'male' } }).expect(200);

      const rejected = (
        await correct(id, rows[0]!, { rejected: true, reason: 'Printed twice' }).expect(200)
      ).body as ReviewRow;
      expect(rejected.status).toBe('rejected');
      expect(rejected.messages).toContainEqual(
        expect.objectContaining({ code: 'row.rejected', message: 'Printed twice' }),
      );
      const batch = (await admin.http.get(`/v1/imports/batches/${batchId}`).expect(200))
        .body as BatchDetail;
      expect(batch.files[0]).toMatchObject({
        status: 'needs_review',
        voterCount: 2,
        rows: { rejected: 1 },
      });
      // A correction to a rejected row keeps it rejected (and its reason).
      const still = (await correct(id, rows[0]!, { values: { age: 44 } }).expect(200))
        .body as ReviewRow;
      expect(still.status).toBe('rejected');
      expect(still.messages.find((m) => m.code === 'row.rejected')?.message).toBe('Printed twice');

      const back = (await correct(id, rows[0]!, { rejected: false }).expect(200)).body as ReviewRow;
      expect(back.status).toBe('accepted');
      expect(back.messages).toEqual([]);
      expect((await t.prisma.importFile.findUniqueOrThrow({ where: { id } })).status).toBe('ready');
      const audit = await t.prisma.auditEvent.findMany({
        where: { action: 'import.row.correct', resourceId: rows[0]! },
        orderBy: { seq: 'asc' },
      });
      expect(audit.map((e) => e.metadata)).toEqual([
        { importFileId: id, fields: [], rejected: true },
        { importFileId: id, fields: ['age'] },
        { importFileId: id, fields: [], rejected: false },
      ]);
    });

    it('setting a field back to the extracted value removes the correction', async () => {
      const { id, rows } = await seedFile(await batchAt((await node('ac', '101')).id));
      await correct(id, rows[1]!, { values: { name: 'Synthetic Person Two', age: 50 } }).expect(
        200,
      );
      const undone = (
        await correct(id, rows[1]!, { values: { name: 'Synthetic Person 2', age: 31 } }).expect(200)
      ).body as ReviewRow;
      expect(undone.corrected).toBeNull();
      // The low-confidence warning is open again.
      expect(undone.status).toBe('warning');
      expect(undone.messages[0]).not.toHaveProperty('resolved');
      const stored = await t.prisma.importRowResult.findUniqueOrThrow({ where: { id: rows[1]! } });
      expect(stored.correctedValues).toBeNull();
    });

    it('a corrected EPIC that another row has is flagged', async () => {
      const { id, rows } = await seedFile(await batchAt((await node('ac', '101')).id));
      const dup = (await correct(id, rows[1]!, { values: { epic: 'tst1000000' } }).expect(200))
        .body as ReviewRow;
      expect(dup.current.epic).toBe('TST1000000');
      expect(dup.messages).toContainEqual(
        expect.objectContaining({ code: 'epic.duplicate', field: 'epic', source: 'review' }),
      );
      expect(dup.status).toBe('warning');
    });

    it('checks the values, and only reviews files waiting for confirmation', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const { id, rows } = await seedFile(batchId);
      for (const values of [
        { age: 5 },
        { epic: 'AB12' },
        { gender: 'unknown' },
        { marker: 'gone' },
        { name: '' },
        { nickname: 'x' },
      ]) {
        const res = await correct(id, rows[0]!, { values }).expect(400);
        expect((res.body as ApiErrorBody).code).toBe('VALIDATION_FAILED');
      }
      for (const body of [{}, { values: {} }]) {
        const empty = (await correct(id, rows[0]!, body).expect(422)).body as ApiErrorBody;
        expect(empty.code).toBe('UNPROCESSABLE');
      }
      // null clears the house number / marks the entry active.
      const cleared = (
        await correct(id, rows[3]!, { values: { houseNumber: null, marker: null } }).expect(200)
      ).body as ReviewRow;
      expect(cleared.current).toMatchObject({ houseNumber: null, marker: null });

      await correct(id, randomUUID(), { rejected: true }).expect(404);
      const other = await seedFile(batchId);
      await correct(id, other.rows[0]!, { rejected: true }).expect(404);

      const failed = await seedFile(batchId, 'failed');
      const res = await correct(failed.id, failed.rows[0]!, { rejected: true }).expect(409);
      expect((res.body as ApiErrorBody).code).toBe('CONFLICT');
    });
  });
});
