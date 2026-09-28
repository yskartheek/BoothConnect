import { createHash, randomUUID } from 'node:crypto';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { ExtractionQueue, type ExtractionRequest } from '../src/imports/extraction-queue';
import type { BatchView, UploadCompleted, UploadTicket } from '../src/imports/imports.service';
import { StorageService } from '../src/imports/storage.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';
import { fakePdf, zipOf } from './support/files';

// Needs MinIO as well as Postgres and Redis: `pnpm infra:up`. Seed (synthetic):
// the admin is assigned to AC 101 (under PC 1, under S99); volunteer A works at
// station 1. Every file here is a synthetic PDF, never real roll data.
const ADMIN = '+919999900001';
const VOLUNTEER_A = '+919999900002';

class RecordingQueue extends ExtractionQueue {
  readonly requests: ExtractionRequest[] = [];
  enqueue(request: ExtractionRequest): Promise<void> {
    this.requests.push(request);
    return Promise.resolve();
  }
}

describe('import batches and uploads (real Postgres + MinIO)', () => {
  let t: TestApp;
  let admin: SignedIn;
  const queue = new RecordingQueue();
  const node = (type: 'state' | 'ac' | 'part' | 'polling_station', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });

  const createBatch = (targetNodeId: string, who: SignedIn = admin) =>
    who.http
      .post('/v1/imports/batches')
      .set('Idempotency-Key', randomUUID())
      .send({ targetNodeId });
  const batchAt = async (targetNodeId: string) =>
    ((await createBatch(targetNodeId).expect(201)).body as BatchView).id;
  const start = (batchId: string, files: { name: string; sizeBytes: number }[]) =>
    admin.http
      .post(`/v1/imports/batches/${batchId}/files`)
      .set('Idempotency-Key', randomUUID())
      .send({ files });
  /** PUTs each part to its presigned URL, as the browser does; returns the ETags. */
  const put = async (ticket: UploadTicket, data: Buffer) => {
    const parts = [];
    for (const part of ticket.parts) {
      const from = (part.partNumber - 1) * ticket.partSizeBytes;
      const res = await fetch(part.url, {
        method: 'PUT',
        body: new Uint8Array(data.subarray(from, from + ticket.partSizeBytes)),
      });
      expect(res.status).toBe(200);
      parts.push({ partNumber: part.partNumber, etag: res.headers.get('etag') ?? '' });
    }
    return parts;
  };
  const complete = (batchId: string, uploadId: string, parts: object[]) =>
    admin.http.post(`/v1/imports/batches/${batchId}/files/${uploadId}/complete`).send({ parts });
  /** The whole browser flow for one file. */
  const upload = async (batchId: string, name: string, data: Buffer) => {
    const [ticket] = (
      (await start(batchId, [{ name, sizeBytes: data.length }]).expect(201)).body as {
        uploads: UploadTicket[];
      }
    ).uploads;
    const parts = await put(ticket!, data);
    return { ticket: ticket!, res: complete(batchId, ticket!.id, parts) };
  };
  const uploaded = async (batchId: string, name: string, data: Buffer) =>
    (await (await upload(batchId, name, data)).res.expect(200)).body as UploadCompleted;

  beforeAll(async () => {
    t = await createTestApp((builder) => builder.overrideProvider(ExtractionQueue).useValue(queue));
    await t.app.get(StorageService).ensureBucket();
    admin = await loginAs(t, ADMIN);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('POST /v1/imports/batches', () => {
    it('an admin opens a batch at any level of their area, audited', async () => {
      const ac = await node('ac', '101');
      const part = await node('part', '1');
      for (const target of [ac, part]) {
        const batch = (await createBatch(target.id).expect(201)).body as BatchView;
        expect(batch).toMatchObject({
          targetNode: { id: target.id, type: target.type },
          status: 'uploading',
          fileCount: 0,
        });
        const events = await t.prisma.auditEvent.count({
          where: { action: 'import.batch.create', resourceId: batch.id },
        });
        expect(events).toBe(1);
      }
    });

    it('a volunteer gets 403', async () => {
      const volunteer = await loginAs(t, VOLUNTEER_A);
      await createBatch((await node('part', '1')).id, volunteer).expect(403);
    });

    it('an admin of AC 101 gets 404 for another AC or a level above their own', async () => {
      const ac = await node('ac', '101');
      const other = await t.prisma.geographyNode.create({
        data: {
          programId: ac.programId,
          parentId: ac.parentId,
          type: 'ac',
          code: '102',
          name: 'Other AC',
        },
      });
      await createBatch(other.id).expect(404);
      await createBatch((await node('state', 'S99')).id).expect(404);
      await createBatch(randomUUID()).expect(404);
      const station = await node('polling_station', '1');
      const res = await createBatch(station.id).expect(422);
      expect((res.body as ApiErrorBody).code).toBe('UNPROCESSABLE');
    });
  });

  describe('uploads', () => {
    it('a PDF is uploaded, verified, hashed and queued for extraction', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const pdf = fakePdf(`single-${randomUUID()}`);
      const done = await uploaded(batchId, 'part-12.pdf', pdf);
      expect(done.files).toEqual([
        expect.objectContaining({
          originalName: 'part-12.pdf',
          sizeBytes: pdf.length,
          status: 'uploaded',
        }),
      ]);
      const file = await t.prisma.importFile.findUniqueOrThrow({
        where: { id: done.files[0]!.id },
      });
      expect(file.checksum).toBe(createHash('sha256').update(pdf).digest('hex'));
      expect(queue.requests).toContainEqual({
        importFileId: file.id,
        bucket: t.app.get(StorageService).bucket,
        key: file.fileRef,
        sha256: file.checksum,
      });
      const batch = await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batch.fileCount).toBe(1);
      expect(
        await t.prisma.auditEvent.count({
          where: {
            action: { in: ['import.upload.start', 'import.upload.complete'] },
            resourceId: batchId,
          },
        }),
      ).toBe(2);
    });

    it('a large PDF goes up in several parts', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const pdf = fakePdf(`large-${randomUUID()}`, 17 * 1024 * 1024);
      const { ticket, res } = await upload(batchId, 'big.pdf', pdf);
      expect(ticket.parts).toHaveLength(2);
      expect(((await res.expect(200)).body as UploadCompleted).files[0]?.sizeBytes).toBe(
        pdf.length,
      );
    });

    it('re-uploading the same PDF is flagged as a duplicate and not queued', async () => {
      const ac = await node('ac', '101');
      const pdf = fakePdf(`dup-${randomUUID()}`);
      const first = await uploaded(await batchAt(ac.id), 'roll.pdf', pdf);
      const queued = queue.requests.length;
      const second = await uploaded(await batchAt(ac.id), 'roll-again.pdf', pdf);
      expect(second.files).toEqual([
        expect.objectContaining({ status: 'duplicate', duplicateOfId: first.files[0]!.id }),
      ]);
      expect(queue.requests).toHaveLength(queued);
    });

    it('a ZIP of 3 PDFs becomes 3 files; other entries are skipped', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const zip = zipOf([
        { name: 'rolls/part-1.pdf', data: fakePdf(`zip-1-${randomUUID()}`) },
        { name: 'rolls/part-2.pdf', data: fakePdf(`zip-2-${randomUUID()}`) },
        { name: 'rolls/', data: Buffer.alloc(0) },
        { name: '__MACOSX/rolls/._part-1.pdf', data: Buffer.from('meta') },
        { name: 'rolls/readme.txt', data: Buffer.from('not a roll') },
        { name: 'rolls/fake.pdf', data: Buffer.from('not really a pdf') },
        { name: 'part-3.PDF', data: fakePdf(`zip-3-${randomUUID()}`) },
      ]);
      const done = await uploaded(batchId, 'ac-101.zip', zip);
      expect(done.files.map((f) => [f.originalName, f.status])).toEqual([
        ['part-1.pdf', 'uploaded'],
        ['part-2.pdf', 'uploaded'],
        ['part-3.PDF', 'uploaded'],
      ]);
      expect(done.skipped).toEqual([
        { name: 'rolls/readme.txt', reason: 'not a PDF' },
        { name: 'rolls/fake.pdf', reason: 'not a PDF (no PDF signature)' },
      ]);
      const files = await t.prisma.importFile.findMany({ where: { batchId } });
      expect(new Set(files.map((f) => f.fileRef)).size).toBe(3);
      // Each PDF is its own object in the bucket, with the content from the ZIP.
      const storage = t.app.get(StorageService);
      for (const file of files) {
        expect(await storage.size(file.fileRef)).toBe(Number(file.sizeBytes));
      }
      const batch = await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batch.fileCount).toBe(3);
    });

    it('completing twice returns the same files and stores nothing new', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const pdf = fakePdf(`twice-${randomUUID()}`);
      const { ticket, res } = await upload(batchId, 'twice.pdf', pdf);
      const first = (await res.expect(200)).body as UploadCompleted;
      const again = (await complete(batchId, ticket.id, [{ partNumber: 1, etag: 'x' }]).expect(200))
        .body as UploadCompleted;
      expect(again.files).toEqual(first.files);
      expect(await t.prisma.importFile.count({ where: { batchId } })).toBe(1);
    });
  });

  describe('rules', () => {
    it('a part-level batch takes exactly one PDF', async () => {
      const partBatch = await batchAt((await node('part', '1')).id);
      const res = await start(partBatch, [
        { name: 'a.pdf', sizeBytes: 100 },
        { name: 'b.pdf', sizeBytes: 100 },
      ]).expect(422);
      expect((res.body as ApiErrorBody).code).toBe('UNPROCESSABLE');
      await start(partBatch, [{ name: 'all.zip', sizeBytes: 100 }]).expect(422);
      await uploaded(partBatch, 'part-1.pdf', fakePdf(`part-${randomUUID()}`));
      await start(partBatch, [{ name: 'another.pdf', sizeBytes: 100 }]).expect(422);
    });

    it('only .pdf and .zip, within the size limits', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      await start(batchId, [{ name: 'roll.docx', sizeBytes: 100 }]).expect(422);
      const res = await start(batchId, [{ name: 'huge.pdf', sizeBytes: 500 * 1024 * 1024 }]).expect(
        413,
      );
      expect((res.body as ApiErrorBody).code).toBe('PAYLOAD_TOO_LARGE');
      await start(batchId, []).expect(400);
    });

    it('a file that is not a PDF, or not the declared size, fails and imports nothing', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const notPdf = await upload(batchId, 'fake.pdf', Buffer.from('plain text, not a PDF'));
      expect(((await notPdf.res.expect(422)).body as ApiErrorBody).message).toBe(
        'The file is not a PDF',
      );

      const pdf = fakePdf(`short-${randomUUID()}`);
      const [ticket] = (
        (await start(batchId, [{ name: 'short.pdf', sizeBytes: pdf.length + 10 }]).expect(201))
          .body as { uploads: UploadTicket[] }
      ).uploads;
      const parts = await put(ticket!, pdf);
      await complete(batchId, ticket!.id, parts).expect(422);
      const stored = await t.prisma.importUpload.findUniqueOrThrow({ where: { id: ticket!.id } });
      expect(stored.status).toBe('failed');
      expect(await t.prisma.importFile.count({ where: { batchId } })).toBe(0);
      // A failed upload stays failed.
      await complete(batchId, ticket!.id, parts).expect(422);
    });

    it('completing before the parts are uploaded is refused, and can be retried', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      const pdf = fakePdf(`later-${randomUUID()}`);
      const [ticket] = (
        (await start(batchId, [{ name: 'later.pdf', sizeBytes: pdf.length }]).expect(201)).body as {
          uploads: UploadTicket[];
        }
      ).uploads;
      await complete(batchId, ticket!.id, [{ partNumber: 1, etag: '"missing"' }]).expect(422);
      const parts = await put(ticket!, pdf);
      await complete(batchId, ticket!.id, parts).expect(200);
    });

    it('someone without access to the batch gets 404', async () => {
      const batchId = await batchAt((await node('ac', '101')).id);
      await admin.http
        .post(`/v1/imports/batches/${randomUUID()}/files`)
        .set('Idempotency-Key', randomUUID())
        .send({ files: [{ name: 'a.pdf', sizeBytes: 10 }] })
        .expect(404);
      await complete(batchId, randomUUID(), [{ partNumber: 1, etag: 'x' }]).expect(404);
    });
  });
});
