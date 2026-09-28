import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';

import { AuditService } from '../../audit/audit.service';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { ImportFileStatus, Prisma } from '../../generated/prisma/client';
import { refreshBatchStatus } from '../batch-status';
import { ExtractionQueue } from '../extraction-queue';
import { StorageService } from '../storage.service';
import { bullConnection } from './connection';
import type {
  ElectorCounts,
  ExtractedHeader,
  ExtractedVoter,
  Field,
  Issue,
  ResultDocument,
  ResultEnvelope,
} from './contract';

type Tx = Prisma.TransactionClient;

/** A result document larger than this is refused (a whole part is a few MB). */
const MAX_RESULT_BYTES = 64 * 1024 * 1024;
const GENDERS = ['male', 'female', 'third_gender'];
const COUNT_KEYS: (keyof ElectorCounts)[] = ['male', 'female', 'thirdGender', 'total'];

type Outcome = { envelope: ResultEnvelope } | { crashed: true };

/** Where the roll fits in the geography, from its cover page (design §3). */
export interface HeaderMatch {
  /** The existing part, or null when it will be created on confirm (`proposedPart`). */
  partNodeId: string | null;
  proposedPart: { code: string; name: string } | null;
  /** Main station first; `nodeId` null for a station that will be created. */
  stations: { code: string; name: string | null; auxiliary: boolean; nodeId: string | null }[];
  /** The part's current revision: confirming this file makes a new source version after it. */
  previousSourceVersionId: string | null;
}

type Matching = { ok: true; match: HeaderMatch } | { ok: false; code: string; message: string };

/**
 * Takes the roll-parser's results (#45): a finished `extract-roll` job's
 * envelope, and the full result document from the bucket. Each file is
 * matched to the geography, its rows are stored for review in
 * `import_row_result`, and it becomes `ready`, `needs_review`, `rejected` or
 * `failed`. Nothing is written to `household` or `voter` here: that happens
 * on confirm (#47).
 *
 * Results arrive through BullMQ queue events, and a sweep every
 * IMPORT_RESULTS_SWEEP_SECONDS picks up any the API missed (e.g. while it was
 * down) and re-sends files that never reached the queue.
 */
@Injectable()
export class ExtractionResultsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExtractionResultsService.name);
  private queue?: Queue;
  private events?: QueueEvents;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly extraction: ExtractionQueue,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const name = this.config.get('ROLL_PARSER_QUEUE', { infer: true });
    const options = {
      connection: bullConnection(this.config.get('REDIS_URL', { infer: true })),
      prefix: this.config.get('ROLL_PARSER_QUEUE_PREFIX', { infer: true }),
    };
    this.queue = new Queue(name, options);
    this.events = new QueueEvents(name, options);
    const settle = ({ jobId }: { jobId: string }) => {
      this.settle(jobId).catch((error: unknown) =>
        this.logger.error(`import file ${jobId}: result not processed`, error as Error),
      );
    };
    this.events.on('completed', settle);
    this.events.on('failed', settle);
    const every = this.config.get('IMPORT_RESULTS_SWEEP_SECONDS', { infer: true }) * 1000;
    this.timer = setInterval(() => {
      this.sweep().catch((error: unknown) =>
        this.logger.error('import results sweep failed', error as Error),
      );
    }, every);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.events?.close();
    await this.queue?.close();
  }

  /**
   * Files waiting too long: extracting ones whose job has finished, and
   * uploaded ones that never reached the queue (sent again; the job id is
   * the file id, so a file is never queued twice).
   */
  async sweep(): Promise<void> {
    const waiting = await this.prisma.importFile.findMany({
      where: { status: { in: ['uploaded', 'extracting'] } },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    for (const file of waiting) {
      if (await this.settle(file.id)) continue;
      if (file.status === 'uploaded' && file.updatedAt.getTime() < Date.now() - 60_000) {
        await this.extraction.enqueue({
          importFileId: file.id,
          bucket: this.storage.bucket,
          key: file.fileRef,
          sha256: file.checksum,
        });
        await this.prisma.importFile.update({
          where: { id: file.id },
          data: { status: 'extracting' },
        });
      }
    }
  }

  /**
   * Applies a finished job's result to its import file. Returns false while
   * the job is still running (or retrying), or when the file isn't this
   * API's (e.g. another test database sharing the queue).
   */
  async settle(importFileId: string): Promise<boolean> {
    const job = await this.queue?.getJob(importFileId);
    if (!job) return false;
    const state = await job.getState();
    let outcome: Outcome;
    if (state === 'completed') {
      outcome = { envelope: job.returnvalue as ResultEnvelope };
    } else if (state === 'failed' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      outcome = { crashed: true };
    } else {
      return false;
    }
    const settled = await this.apply(importFileId, outcome);
    if (settled) await job.remove().catch(() => undefined);
    return settled;
  }

  private async apply(importFileId: string, outcome: Outcome): Promise<boolean> {
    const file = await this.prisma.importFile.findUnique({
      where: { id: importFileId },
      include: { batch: true },
    });
    if (!file || !['uploaded', 'extracting'].includes(file.status)) return false;

    if ('crashed' in outcome) {
      return this.finish(file.id, file.batchId, {
        status: 'failed',
        error: {
          code: 'extraction_failed',
          message:
            'The file could not be processed. Upload it again; ask for help if this repeats.',
        },
      });
    }
    const { envelope } = outcome;
    if (envelope.status === 'failed' || !envelope.resultKey) {
      const failure = envelope.failure ?? { code: 'extraction_failed', message: 'No result' };
      return this.finish(file.id, file.batchId, {
        // A file that isn't a roll at all is rejected rather than failed.
        status: failure.code === 'not_a_roll' ? 'rejected' : 'failed',
        error: failure,
      });
    }

    const doc = await this.readResult(envelope.resultKey);
    if (doc.importFileId !== file.id) throw new Error('The result belongs to another file');
    const extraction = doc.extraction;
    const header = extraction.header.header;
    const headerValues = header ? unwrap(header) : null;
    const printed = extraction.header.printedTotals
      ? (unwrap(extraction.header.printedTotals) as {
          startSerial: number | null;
          endSerial: number | null;
          counts: Record<keyof ElectorCounts, number | null>;
        })
      : null;
    const extracted = extraction.extractedTotals;
    const fileIssues: Issue[] = [...extraction.header.issues, ...extraction.issues];
    const common = {
      pageCount: extraction.pageCount,
      extractionMethod: 'ocr' as const,
      qualityScore: Math.min(1, Math.max(0, extraction.qualityScore)),
      printedTotals: printed ?? undefined,
      extractedTotals: { ...extracted },
      extractedAt: new Date(),
    };

    const matching = await this.match(file.batch.targetNodeId, header);
    if (!matching.ok) {
      return this.finish(file.id, file.batchId, {
        ...common,
        status: 'rejected',
        detectedHeader: toJson({ header: headerValues, issues: fileIssues }),
        error: { code: matching.code, message: matching.message },
      });
    }

    const totalsMatch =
      printed !== null && COUNT_KEYS.every((key) => printed.counts[key] === extracted[key]);
    if (!totalsMatch && !fileIssues.some((i) => i.code === 'totals.extracted_mismatch')) {
      fileIssues.push({
        code: printed ? 'totals.extracted_mismatch' : 'totals.missing',
        severity: 'error',
        message: printed
          ? 'The voters read from the roll do not add up to the totals printed on it'
          : 'The totals printed on the roll could not be read',
      });
    }

    const elsewhere = await this.epicsElsewhere(
      file.programId,
      file.id,
      matching.match.partNodeId,
      extraction.rows,
    );
    const rows = extraction.rows.map((row) => toRowResult(file.id, row, elsewhere));
    const rowErrors = rows.some((row) => row.messages.some((m) => m.severity === 'error'));
    const status: ImportFileStatus =
      envelope.summary?.needsReview || !totalsMatch || rowErrors ? 'needs_review' : 'ready';

    return this.finish(
      file.id,
      file.batchId,
      {
        ...common,
        status,
        partNodeId: matching.match.partNodeId,
        detectedHeader: toJson({
          header: headerValues,
          matching: matching.match,
          issues: fileIssues,
          pageImages: doc.pageImages,
          resultKey: envelope.resultKey,
          workerVersion: doc.workerVersion,
        }),
        error: undefined,
      },
      rows,
    );
  }

  /**
   * Header matching (design §3): the roll's State, PC (where printed), AC and
   * part must lie inside the batch's target, and the AC must already be in
   * the master data. The part and its stations are linked when they exist,
   * or proposed for creation on confirm.
   */
  private async match(targetNodeId: string, header: ExtractedHeader | null): Promise<Matching> {
    const state = str(header?.stateCode);
    const pc = str(header?.pcNumber);
    const ac = str(header?.acNumber);
    const part = str(header?.partNumber);
    if (!header || !state || !ac || !part) {
      return {
        ok: false,
        code: 'header.incomplete',
        message: "The cover page couldn't be read: the state, AC or part number is missing",
      };
    }
    const path = await this.prisma.geographyClosure.findMany({
      where: { descendantId: targetNodeId },
      include: { ancestor: true },
    });
    const onPath = (type: string) => path.find((p) => p.ancestor.type === type)?.ancestor;
    const printed: Record<string, string | null> = { state, pc, ac, part };
    for (const type of ['state', 'pc', 'ac', 'part']) {
      const node = onPath(type);
      const value = printed[type];
      if (node && value !== null && value !== undefined && node.code !== value) {
        return {
          ok: false,
          code: 'header.outside_target',
          message: `This roll is for ${state} AC ${ac} part ${part}, which is not under the batch's ${type.toUpperCase()} ${node.code}`,
        };
      }
    }

    const target = path.find((p) => p.ancestorId === targetNodeId)!.ancestor;
    const acNode =
      onPath('ac') ??
      (await this.prisma.geographyNode.findFirst({
        where: {
          programId: target.programId,
          type: 'ac',
          code: ac,
          ancestors: { some: { ancestorId: targetNodeId } },
        },
      }));
    if (!acNode) {
      return {
        ok: false,
        code: 'header.ac_unknown',
        message: `AC ${ac} is not in the master data yet; add it before importing its rolls`,
      };
    }
    const partNode = await this.prisma.geographyNode.findFirst({
      where: { parentId: acNode.id, type: 'part', code: part },
      include: {
        children: { where: { type: 'polling_station' } },
        sourceVersions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const printedStations = [
      { station: header.pollingStation, auxiliary: false },
      ...header.auxiliaryStations.map((station) => ({ station, auxiliary: true })),
    ];
    return {
      ok: true,
      match: {
        partNodeId: partNode?.id ?? null,
        proposedPart: partNode
          ? null
          : { code: part, name: str(header.mainTown) ?? `Part ${part}` },
        stations: printedStations.flatMap(({ station, auxiliary }) => {
          const code = str(station?.number);
          if (!code) return [];
          return [
            {
              code,
              name: str(station.name),
              auxiliary,
              nodeId: partNode?.children.find((c) => c.code === code)?.id ?? null,
            },
          ];
        }),
        previousSourceVersionId: partNode?.sourceVersions[0]?.id ?? null,
      },
    };
  }

  /**
   * EPIC numbers that are also on another part: in another imported file of
   * the program (other than this part's earlier revisions) or among another
   * part's active voters. Within one part, the roll-parser already checks.
   */
  private async epicsElsewhere(
    programId: string,
    importFileId: string,
    partNodeId: string | null,
    rows: ExtractedVoter[],
  ): Promise<Set<string>> {
    const epics = [...new Set(rows.map((r) => r.epic.value).filter((e): e is string => !!e))];
    if (epics.length === 0) return new Set();
    const [inFiles, inVoters] = await Promise.all([
      this.prisma.$queryRaw<{ epic: string }[]>`
        SELECT DISTINCT r.extracted_values->>'epic' AS epic
        FROM import_row_result r JOIN import_file f ON f.id = r.import_file_id
        WHERE f.program_id = ${programId}::uuid AND f.id <> ${importFileId}::uuid
          AND f.status IN ('ready', 'needs_review', 'confirmed')
          AND f.part_node_id IS DISTINCT FROM ${partNodeId}::uuid
          AND r.extracted_values->>'epic' = ANY(${epics})`,
      this.prisma.voter.findMany({
        where: {
          programId,
          recordStatus: 'active',
          sourceVoterId: { in: epics },
          ...(partNodeId ? { partId: { not: partNodeId } } : {}),
        },
        select: { sourceVoterId: true },
      }),
    ]);
    return new Set([...inFiles.map((r) => r.epic), ...inVoters.map((v) => v.sourceVoterId!)]);
  }

  private async readResult(key: string): Promise<ResultDocument> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of await this.storage.read(key)) {
      size += (chunk as Buffer).length;
      if (size > MAX_RESULT_BYTES) throw new Error('The result document is too large');
      chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ResultDocument;
  }

  /** Stores the outcome (and rows) in one transaction, then the batch's status. */
  private async finish(
    importFileId: string,
    batchId: string,
    data: Prisma.ImportFileUncheckedUpdateInput & { status: ImportFileStatus },
    rows: Prisma.ImportRowResultCreateManyInput[] = [],
  ): Promise<boolean> {
    const done = await this.prisma.$transaction(async (tx: Tx) => {
      // Only a file still waiting for its result; a second delivery is a no-op.
      const claimed = await tx.importFile.updateMany({
        where: { id: importFileId, status: { in: ['uploaded', 'extracting'] } },
        data: { ...(data as Prisma.ImportFileUncheckedUpdateManyInput) },
      });
      if (claimed.count === 0) return false;
      for (let i = 0; i < rows.length; i += 500) {
        await tx.importRowResult.createMany({ data: rows.slice(i, i + 500) });
      }
      await refreshBatchStatus(tx, batchId);
      await this.audit.record(
        {
          action: 'import.file.extracted',
          resourceType: 'import_file',
          resourceId: importFileId,
          result: data.status === 'failed' ? 'failure' : 'success',
          // Counts and codes only: never voter data.
          metadata: {
            status: data.status,
            rows: rows.length,
            ...(data.error && typeof data.error === 'object'
              ? { code: (data.error as { code?: string }).code }
              : {}),
          },
        },
        tx,
      );
      return true;
    });
    if (done) this.logger.log(`import file ${importFileId}: ${data.status} (${rows.length} rows)`);
    return done;
  }
}

/** A row for review: values and confidences side by side, issues as messages. */
function toRowResult(
  importFileId: string,
  row: ExtractedVoter,
  epicsElsewhere: Set<string>,
): Prisma.ImportRowResultCreateManyInput & { messages: Issue[] } {
  const fields = {
    epic: row.epic,
    name: row.name,
    relationType: row.relationType,
    relativeName: row.relativeName,
    houseNumber: row.houseNumber,
    age: row.age,
    gender: row.gender,
    printedSerial: row.printedSerial,
  };
  const issues: Issue[] = [...row.issues];
  const gender = row.gender.value;
  if (gender !== null && !GENDERS.includes(gender)) {
    issues.push({
      code: 'gender.invalid',
      severity: 'error',
      message: 'Unknown gender',
      field: 'gender',
    });
  }
  if (row.epic.value && epicsElsewhere.has(row.epic.value)) {
    issues.push({
      code: 'epic.duplicate_elsewhere',
      severity: 'warning',
      message: 'This EPIC number is also listed in another part',
      field: 'epic',
    });
  }
  return {
    importFileId,
    page: row.page,
    boxIndex: row.boxIndex,
    sectionNo: row.sectionNumber.value,
    serialNo: row.serial,
    status: issues.length > 0 ? 'warning' : 'accepted',
    messages: issues.map(({ code, severity, message, field }) => ({
      code,
      severity,
      message,
      field: field ?? null,
    })),
    rawText: row.rawText,
    extractedValues: {
      ...Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value])),
      marker: row.marker,
    },
    fieldConfidence: Object.fromEntries(
      Object.entries(fields).map(([k, f]) => [k, f.confidence ?? null]),
    ),
  };
}

const isField = (value: unknown): value is Field<unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && 'value' in value;

/** Replaces every Field with its value, recursively. */
export function unwrap(value: unknown): unknown {
  if (isField(value)) return value.value;
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
  }
  return value;
}

const str = (field: Field<unknown> | undefined | null): string | null => {
  const value = field?.value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
