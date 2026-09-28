import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';

import type { Env } from '../src/config/env';
import {
  DEFAULT_JOB_OPTIONS,
  EXTRACTION_JOB_OPTIONS,
} from '../src/imports/extraction/bull-extraction.queue';
import { bullConnection } from '../src/imports/extraction/connection';
import { ExtractionResultsService } from '../src/imports/extraction/results.service';
import type { UploadCompleted, UploadTicket } from '../src/imports/imports.service';
import { StorageService } from '../src/imports/storage.service';
import { createTestApp, type TestApp } from './support/app';
import { loginAs, type SignedIn } from './support/auth';
import { FakeRollParser, type Scenario } from './support/fake-roll-parser';
import { fakePdf } from './support/files';

// Needs Postgres, Redis and MinIO (`pnpm infra:up`). A fake roll-parser worker
// (test/support/fake-roll-parser.ts) takes the API's real BullMQ jobs and
// answers per the v1 contract with synthetic results: no real roll data.
// Seed (synthetic): S99 → PC 1 → AC 101 → part 1 (stations 1 and 1A) and
// part 2 (station 2); the admin is assigned to AC 101.
const ADMIN = '+919999900001';

// Each test waits for real round trips through Redis and MinIO; under a full
// parallel run that can take longer than Jest's default 5 s.
jest.setTimeout(30_000);

describe('roll extraction hand-off and results (real Postgres + Redis + MinIO)', () => {
  let t: TestApp;
  let admin: SignedIn;
  let worker: FakeRollParser;
  let queue: Queue;
  let events: QueueEvents;
  const scenarios = new Map<string, Scenario>();

  const node = (type: 'state' | 'ac' | 'part', code: string) =>
    t.prisma.geographyNode.findFirstOrThrow({ where: { type, code } });
  const batchAt = async (targetNodeId: string) =>
    (
      (
        await admin.http
          .post('/v1/imports/batches')
          .set('Idempotency-Key', randomUUID())
          .send({ targetNodeId })
          .expect(201)
      ).body as { id: string }
    ).id;
  /** Uploads a synthetic PDF for `scenario` and returns its import file id. */
  const upload = async (batchId: string, scenario: Scenario) => {
    const label = `scenario-${randomUUID()}`;
    scenarios.set(label, scenario);
    const pdf = fakePdf(label);
    const start = await admin.http
      .post(`/v1/imports/batches/${batchId}/files`)
      .set('Idempotency-Key', randomUUID())
      .send({ files: [{ name: `${label}.pdf`, sizeBytes: pdf.length }] })
      .expect(201);
    const ticket = (start.body as { uploads: UploadTicket[] }).uploads[0]!;
    const put = await fetch(ticket.parts[0]!.url, { method: 'PUT', body: new Uint8Array(pdf) });
    const done = await admin.http
      .post(`/v1/imports/batches/${batchId}/files/${ticket.id}/complete`)
      .send({ parts: [{ partNumber: 1, etag: put.headers.get('etag') }] })
      .expect(200);
    return (done.body as UploadCompleted).files[0]!.id;
  };
  /** Waits until the API has taken the file's result (or times out). */
  const settled = async (fileId: string) => {
    for (let i = 0; i < 250; i += 1) {
      const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } });
      if (!['uploaded', 'extracting'].includes(file.status)) return file;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`import file ${fileId} was never settled`);
  };
  const rowsOf = (n: number, epics: string[] = []) =>
    Array.from({ length: n }, (_, i) => ({
      gender: i % 2 === 0 ? ('male' as const) : ('female' as const),
      ...(epics[i] ? { epic: epics[i] } : {}),
    }));
  const livingCounts = async () => ({
    households: await t.prisma.household.count(),
    voters: await t.prisma.voter.count(),
  });

  beforeAll(async () => {
    t = await createTestApp((builder) =>
      builder
        .overrideProvider(EXTRACTION_JOB_OPTIONS)
        // One attempt, so the transient-failure test doesn't wait for backoff.
        .useValue({ ...DEFAULT_JOB_OPTIONS, attempts: 1, backoff: undefined }),
    );
    const storage = t.app.get(StorageService);
    await storage.ensureBucket();
    const config = t.app.get(ConfigService<Env, true>);
    const redisUrl = config.get('REDIS_URL', { infer: true });
    worker = new FakeRollParser(storage, scenarios, redisUrl, {
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
    });
    queue = new Queue('roll-extraction', { connection: bullConnection(redisUrl), prefix: 'bull' });
    events = new QueueEvents('roll-extraction', {
      connection: bullConnection(redisUrl),
      prefix: 'bull',
    });
    admin = await loginAs(t, ADMIN);
  });

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    await queue?.close();
    await t?.close();
  });

  it('publishes an extract-roll job per the v1 contract', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const fileId = await upload(batchId, { rows: rowsOf(2) });
    await settled(fileId);
    const file = await t.prisma.importFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(worker.payloads.find((p) => p.importFileId === fileId)).toEqual({
      version: 1,
      importFileId: fileId,
      bucket: t.app.get(StorageService).bucket,
      key: file.fileRef,
      sha256: file.checksum,
      resultPrefix: `extractions/${fileId}/`,
      options: { pageImages: true },
    });
    // The finished job is removed once its result is stored.
    expect(await queue.getJob(fileId)).toBeUndefined();
  });

  it('a good roll is ready: header matched, rows stored with confidence, nothing live yet', async () => {
    const before = await livingCounts();
    const batchId = await batchAt((await node('ac', '101')).id);
    const fileId = await upload(batchId, { rows: rowsOf(4) });
    const file = await settled(fileId);
    const part1 = await node('part', '1');

    expect(file).toMatchObject({
      status: 'ready',
      partNodeId: part1.id,
      pageCount: 4,
      extractionMethod: 'ocr',
      qualityScore: 0.9,
      extractedTotals: { male: 2, female: 2, thirdGender: 0, total: 4 },
      printedTotals: {
        startSerial: 1,
        endSerial: 4,
        counts: { male: 2, female: 2, thirdGender: 0, total: 4 },
      },
    });
    const detected = file.detectedHeader as {
      header: { stateCode: string; acNumber: number; partNumber: number };
      matching: {
        partNodeId: string;
        proposedPart: null;
        stations: { code: string; nodeId: string | null }[];
        previousSourceVersionId: string | null;
      };
    };
    expect(detected.header).toMatchObject({ stateCode: 'S99', acNumber: 101, partNumber: 1 });
    const stations = await t.prisma.geographyNode.findMany({ where: { parentId: part1.id } });
    expect(detected.matching.stations).toEqual([
      expect.objectContaining({
        code: '1',
        auxiliary: false,
        nodeId: stations.find((s) => s.code === '1')!.id,
      }),
      expect.objectContaining({
        code: '1A',
        auxiliary: true,
        nodeId: stations.find((s) => s.code === '1A')!.id,
      }),
    ]);
    // Part 1 already has the seed's revision: confirming makes a new version after it.
    const current = await t.prisma.sourceVersion.findFirstOrThrow({
      where: { partNodeId: part1.id },
    });
    expect(detected.matching.previousSourceVersionId).toBe(current.id);

    const rows = await t.prisma.importRowResult.findMany({
      where: { importFileId: fileId },
      orderBy: { serialNo: 'asc' },
    });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      page: 3,
      boxIndex: 0,
      sectionNo: 1,
      serialNo: 1,
      status: 'accepted',
      extractedValues: expect.objectContaining({
        name: 'Synthetic Person 1',
        gender: 'male',
        age: 30,
      }),
      fieldConfidence: expect.objectContaining({ name: 0.7, epic: 0.95 }),
    });

    // Plan §8: nothing reaches household or voter before confirm.
    expect(await livingCounts()).toEqual(before);
    const batch = await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('review');
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'import.file.extracted', resourceId: fileId },
      }),
    ).toBe(1);
  });

  it('a roll from another AC is rejected, with the reason', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const file = await settled(await upload(batchId, { ac: 40, rows: rowsOf(2) }));
    expect(file.status).toBe('rejected');
    expect(file.error).toMatchObject({
      code: 'header.outside_target',
      message: expect.stringContaining('AC 40'),
    });
    expect(await t.prisma.importRowResult.count({ where: { importFileId: file.id } })).toBe(0);
  });

  it('a part-level batch rejects a roll for another part', async () => {
    const batchId = await batchAt((await node('part', '1')).id);
    const file = await settled(await upload(batchId, { part: 2, rows: rowsOf(2) }));
    expect(file).toMatchObject({ status: 'rejected', error: { code: 'header.outside_target' } });
  });

  it('a totals mismatch forces review', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const file = await settled(
      await upload(batchId, {
        rows: rowsOf(4),
        printed: { male: 3, female: 2, thirdGender: 0, total: 5 },
      }),
    );
    expect(file.status).toBe('needs_review');
    expect((file.detectedHeader as { issues: { code: string }[] }).issues).toContainEqual(
      expect.objectContaining({ code: 'totals.extracted_mismatch' }),
    );
  });

  it('missing printed totals, the worker asking for review, or a row error force review', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const noTotals = await settled(await upload(batchId, { rows: rowsOf(2), printed: null }));
    expect(noTotals.status).toBe('needs_review');
    const flagged = await settled(await upload(batchId, { rows: rowsOf(2), needsReview: true }));
    expect(flagged.status).toBe('needs_review');
    const rowError = await settled(
      await upload(batchId, {
        rows: [
          {
            gender: 'male',
            issues: [
              {
                code: 'age.out_of_range',
                severity: 'error',
                message: 'Age outside 18–120',
                field: 'age',
              },
            ],
          },
          { gender: 'female' },
        ],
      }),
    );
    expect(rowError.status).toBe('needs_review');
    const [bad, good] = await t.prisma.importRowResult.findMany({
      where: { importFileId: rowError.id },
      orderBy: { serialNo: 'asc' },
    });
    expect(bad).toMatchObject({
      status: 'warning',
      messages: [expect.objectContaining({ code: 'age.out_of_range' })],
    });
    expect(good?.status).toBe('accepted');
  });

  it('a part not yet in the tree is proposed, not created', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const nodesBefore = await t.prisma.geographyNode.count();
    const file = await settled(await upload(batchId, { part: 7, rows: rowsOf(2) }));
    expect(file).toMatchObject({ status: 'ready', partNodeId: null });
    expect((file.detectedHeader as { matching: unknown }).matching).toMatchObject({
      partNodeId: null,
      proposedPart: { code: '7', name: 'Synthetic Town 7' },
      stations: [expect.objectContaining({ code: '7', nodeId: null })],
      previousSourceVersionId: null,
    });
    expect(await t.prisma.geographyNode.count()).toBe(nodesBefore);
  });

  it('an EPIC already listed in another part is a warning on the row', async () => {
    const other = await t.prisma.voter.findFirstOrThrow({
      where: { part: { code: '2' }, origin: 'official_import' },
    });
    const batchId = await batchAt((await node('ac', '101')).id);
    const file = await settled(await upload(batchId, { rows: rowsOf(2, [other.sourceVoterId!]) }));
    const rows = await t.prisma.importRowResult.findMany({
      where: { importFileId: file.id },
      orderBy: { serialNo: 'asc' },
    });
    expect(rows[0]).toMatchObject({
      status: 'warning',
      messages: [
        expect.objectContaining({ code: 'epic.duplicate_elsewhere', severity: 'warning' }),
      ],
    });
    expect(rows[1]?.status).toBe('accepted');
  });

  it('the worker’s failures: unreadable is failed, not a roll is rejected', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const unreadable = await settled(
      await upload(batchId, { failure: { code: 'pdf_unreadable', message: 'Not a readable PDF' } }),
    );
    expect(unreadable).toMatchObject({ status: 'failed', error: { code: 'pdf_unreadable' } });
    const notRoll = await settled(
      await upload(batchId, { failure: { code: 'not_a_roll', message: 'No voter pages' } }),
    );
    expect(notRoll).toMatchObject({ status: 'rejected', error: { code: 'not_a_roll' } });
    // Only failures: the batch stays open for the right files.
    const batch = await t.prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('uploading');
  });

  it('a job that fails outright (after its attempts) marks the file failed', async () => {
    const batchId = await batchAt((await node('ac', '101')).id);
    const file = await settled(await upload(batchId, { crash: true }));
    expect(file).toMatchObject({ status: 'failed', error: { code: 'extraction_failed' } });
  });

  it('a result the API missed is picked up by the sweep, once', async () => {
    const results = t.app.get(ExtractionResultsService);
    const batchId = await batchAt((await node('ac', '101')).id);
    const fileId = await upload(batchId, { rows: rowsOf(2) });
    const file = await settled(fileId);
    expect(file.status).toBe('ready');

    // Put it back as if the event had been lost, with its job still finished.
    await t.prisma.importRowResult.deleteMany({ where: { importFileId: fileId } });
    await t.prisma.importFile.update({ where: { id: fileId }, data: { status: 'extracting' } });
    const job = await queue.add(
      'extract-roll',
      worker.payloads.find((p) => p.importFileId === fileId)!,
      {
        jobId: fileId,
      },
    );
    await job.waitUntilFinished(events);
    // The sweep and two late deliveries of the same result, all at once:
    // exactly one of them stores it.
    await Promise.all([results.sweep(), results.settle(fileId), results.settle(fileId)]);
    const swept = await settled(fileId);
    expect(swept.status).toBe('ready');
    expect(await t.prisma.importRowResult.count({ where: { importFileId: fileId } })).toBe(2);
    expect(
      await t.prisma.auditEvent.count({
        where: { action: 'import.file.extracted', resourceId: fileId },
      }),
    ).toBe(2);
  });
});
