import { Readable } from 'node:stream';

import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { CSV_BOM, csvLine } from '../common/csv';
import {
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  type Page,
  toPage,
} from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import {
  type GeographyNodeType,
  type ImportBatchStatus,
  type ImportFileStatus,
  type ImportRowResult,
  type ImportRowStatus,
  Prisma,
} from '../generated/prisma/client';
import { refreshBatchStatus } from './batch-status';
import type { CorrectRowDto, PreviewQuery } from './dto';
import type { ElectorCounts, Issue, PageImage } from './extraction/contract';
import type { HeaderMatch } from './extraction/results.service';
import { householdCount, prepareVoters } from './confirm-rules';
import { auditBase } from './imports.service';
import {
  countVoters,
  currentValues,
  hasOpenError,
  LOW_CONFIDENCE,
  normaliseMessages,
  printedCounts,
  REJECTED_CODE,
  revalidate,
  type RowMessage,
  rowStatus,
  type RowValues,
  totalsCheck,
  type TotalsCheck,
} from './review-rules';
import { StorageService } from './storage.service';

type Tx = Prisma.TransactionClient;

/** What #45 stored in `import_file.detected_header`. */
interface DetectedHeader {
  header?: Record<string, unknown> | null;
  matching?: HeaderMatch;
  issues?: Issue[];
  pageImages?: PageImage[];
}

export interface FileStatusView {
  id: string;
  originalName: string;
  sizeBytes: number;
  status: ImportFileStatus;
  duplicateOfId: string | null;
  /** Why the file was rejected or failed. */
  error: { code: string; message: string } | null;
  /** The existing part it was matched to. */
  part: { id: string; code: string; name: string } | null;
  /** A part that will be created on confirm. */
  proposedPart: { code: string; name: string } | null;
  pageCount: number | null;
  /** Voter boxes read from the roll. */
  rowCount: number;
  rows: Record<ImportRowStatus, number>;
  /** Rows that would become active voters (not rejected, not marked deleted). */
  voterCount: number;
  qualityScore: number | null;
  /**
   * Active voters (after corrections and rejected rows) match the totals
   * printed in the roll; null when the printed totals couldn't be read.
   */
  totalsMatch: boolean | null;
  extractedAt: Date | null;
  confirmedAt: Date | null;
}

export interface BatchDetail {
  id: string;
  targetNode: { id: string; type: GeographyNodeType; code: string; name: string };
  status: ImportBatchStatus;
  fileCount: number;
  /** Files per status. */
  statusCounts: Partial<Record<ImportFileStatus, number>>;
  files: FileStatusView[];
  createdAt: Date;
}

export interface ReviewRow {
  id: string;
  page: number;
  boxIndex: number;
  sectionNo: number | null;
  serialNo: number | null;
  status: ImportRowStatus;
  messages: RowMessage[];
  rawText: string | null;
  /** As read from the roll (never changed). */
  extracted: RowValues;
  /** 0–1 per field. */
  confidence: Record<string, number | null>;
  /** The admin's corrections, if any. */
  corrected: RowValues | null;
  /** What confirm will import: extracted values with the corrections on top. */
  current: RowValues;
  correctedBy: { id: string; name: string } | null;
  correctedAt: Date | null;
}

export interface FilePreview {
  file: FileStatusView;
  /** The cover page as read: state, AC, part, revision, stations… */
  header: Record<string, unknown> | null;
  /** Main station first; `nodeId` null for a station that will be created on confirm. */
  stations: HeaderMatch['stations'];
  /** The part's current revision; confirming makes a new source version after it. */
  previousSourceVersionId: string | null;
  /** File-level issues from extraction (header, pages, totals). */
  issues: Issue[];
  /** Voter pages with an image for side-by-side correction. */
  pages: { page: number; width: number; height: number }[];
  totals: TotalsCheck;
  /**
   * What confirming now would commit: voters, and households (one per house
   * number, or one per voter without one). Null while rows still have errors
   * or miss the EPIC, section or serial (confirm would refuse).
   */
  willCommit: { voters: number; households: number } | null;
  rows: Page<ReviewRow> & { total: number };
}

/** Review is possible while a file waits for confirmation. */
const REVIEWABLE: ImportFileStatus[] = ['ready', 'needs_review'];
const ROW_SELECT = {
  id: true,
  status: true,
  messages: true,
  extractedValues: true,
  correctedValues: true,
  sectionNo: true,
} as const;

const conflict = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
const unprocessable = (message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, message);

/**
 * Roll imports, step 3 (#46; design §3 "Batch progress" and "Review"): the
 * batch's per-file progress, a file's preview (header, proposed part and
 * stations, totals check, rows to review), its voter-page images, and row
 * corrections. Corrections never overwrite what was extracted: they are kept
 * next to it (`corrected_values`, who and when) and applied on confirm (#47).
 */
@Injectable()
export class ImportReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async batch(scope: Scope, batchId: string): Promise<BatchDetail> {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: {
        targetNode: { select: { id: true, type: true, code: true, name: true } },
        files: { include: { partNode: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!batch || !(await this.nodeInScope(scope, batch.targetNodeId))) throw notFound('Batch');
    const counts = await this.rowCounts(Prisma.sql`f.batch_id = ${batchId}::uuid`);
    const files = batch.files.map((file) => fileView(file, counts.get(file.id)));
    const statusCounts: Partial<Record<ImportFileStatus, number>> = {};
    for (const file of files) statusCounts[file.status] = (statusCounts[file.status] ?? 0) + 1;
    return {
      id: batch.id,
      targetNode: batch.targetNode,
      status: batch.status,
      fileCount: batch.fileCount,
      statusCounts,
      files,
      createdAt: batch.createdAt,
    };
  }

  async preview(scope: Scope, fileId: string, query: PreviewQuery): Promise<FilePreview> {
    const file = await this.fileInScope(scope, fileId);
    const counts = await this.rowCounts(Prisma.sql`f.id = ${fileId}::uuid`);
    const detected = (file.detectedHeader ?? {}) as DetectedHeader;
    const all = await this.prisma.importRowResult.findMany({
      where: { importFileId: fileId },
      select: { ...ROW_SELECT, id: true, serialNo: true, rawText: true },
    });
    // What confirm would commit now, as confirm prepares it.
    const prepared = prepareVoters(all);
    return {
      file: fileView(file, counts.get(file.id)),
      header: detected.header ?? null,
      stations: detected.matching?.stations ?? [],
      previousSourceVersionId: detected.matching?.previousSourceVersionId ?? null,
      issues: detected.issues ?? [],
      pages: voterPages(detected).map(({ page, width, height }) => ({ page, width, height })),
      totals: totals(file, all),
      willCommit: prepared.ok
        ? { voters: prepared.voters.length, households: householdCount(prepared.voters) }
        : null,
      rows: await this.rows(fileId, query),
    };
  }

  /**
   * The rejected and warning rows of a file as CSV, for working through
   * offline: position, the values as extracted, the corrections and the
   * messages. Every cell is formula-injection safe. The export is audited.
   */
  async rejectionsCsv(
    scope: Scope,
    actor: Actor,
    fileId: string,
  ): Promise<{ filename: string; csv: Readable }> {
    const file = await this.fileInScope(scope, fileId);
    const where: Prisma.ImportRowResultWhereInput = {
      importFileId: fileId,
      status: { in: ['rejected', 'warning'] },
    };
    const rows = await this.prisma.importRowResult.count({ where });
    await this.audit.record({
      ...auditBase(actor),
      action: 'import.file.rejections_export',
      resourceType: 'import_file',
      resourceId: fileId,
      metadata: { rows },
    });
    const prisma = this.prisma;
    async function* lines(): AsyncGenerator<string> {
      yield CSV_BOM + csvLine(CSV_COLUMNS);
      let after: { page: number; boxIndex: number } | null = null;
      for (;;) {
        const cursor: { page: number; boxIndex: number } | null = after;
        const batch: ImportRowResult[] = await prisma.importRowResult.findMany({
          where: {
            ...where,
            ...(cursor && {
              OR: [
                { page: { gt: cursor.page } },
                { page: cursor.page, boxIndex: { gt: cursor.boxIndex } },
              ],
            }),
          },
          orderBy: [{ page: 'asc' }, { boxIndex: 'asc' }],
          take: CSV_BATCH,
        });
        for (const row of batch) yield csvLine(csvRow(row));
        if (batch.length < CSV_BATCH) return;
        const last = batch.at(-1)!;
        after = { page: last.page, boxIndex: last.boxIndex };
      }
    }
    const base = file.originalName.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_');
    return { filename: `rejections-${base || file.id}.csv`, csv: Readable.from(lines()) };
  }

  /** The JPEG of one voter page. Cover, maps and summary pages are never served. */
  async pageImage(scope: Scope, fileId: string, page: number): Promise<Readable> {
    const file = await this.fileInScope(scope, fileId);
    const image = voterPages((file.detectedHeader ?? {}) as DetectedHeader).find(
      (p) => p.page === page,
    );
    // Only objects this file's extraction wrote.
    if (!image || !image.key.startsWith(`extractions/${file.id}/`)) throw notFound('Page image');
    try {
      return await this.storage.read(image.key);
    } catch {
      throw notFound('Page image');
    }
  }

  /**
   * Corrects fields of one row and/or rejects it (or takes a rejection back).
   * The row's checks and the file's totals check run again, and the file
   * becomes `ready` or `needs_review` accordingly.
   */
  async correctRow(
    scope: Scope,
    actor: Actor,
    fileId: string,
    rowId: string,
    dto: CorrectRowDto,
  ): Promise<ReviewRow> {
    const given = Object.entries(dto.values ?? {}).filter(([, value]) => value !== undefined);
    if (given.length === 0 && dto.rejected === undefined) {
      throw unprocessable('Give corrected values, or rejected: true or false');
    }
    await this.fileInScope(scope, fileId);
    await this.prisma.$transaction(async (tx) => {
      // One review change at a time per file: the totals check reads every row.
      await tx.$queryRaw`SELECT id FROM import_file WHERE id = ${fileId}::uuid FOR UPDATE`;
      const locked = await tx.importFile.findUniqueOrThrow({ where: { id: fileId } });
      if (!REVIEWABLE.includes(locked.status)) {
        throw conflict(`A ${locked.status} file can't be reviewed`);
      }
      const row = await tx.importRowResult.findFirst({
        where: { id: rowId, importFileId: fileId },
      });
      if (!row) throw notFound('Row');

      const extracted = currentValues(row.extractedValues as RowValues, row.sectionNo, null);
      const corrected: RowValues = { ...((row.correctedValues as RowValues | null) ?? {}) };
      const changed: string[] = [];
      for (const [field, value] of given) {
        if (value === extracted[field]) delete corrected[field];
        else corrected[field] = value;
        changed.push(field);
      }
      const messages = normaliseMessages(row.messages);
      const wasRejected = rowStatus(messages) === 'rejected';
      const rejected = dto.rejected ?? wasRejected;
      const reason =
        dto.reason ??
        messages.find((m) => m.code === REJECTED_CODE)?.message ??
        'Rejected during review';
      const current = currentValues(extracted, row.sectionNo, corrected);
      const added = await this.reviewChecks(tx, fileId, rowId, current, corrected);
      const next = revalidate(messages, corrected, rejected ? { reason } : null, added);
      const hasCorrections = Object.keys(corrected).length > 0;

      await tx.importRowResult.update({
        where: { id: rowId },
        data: {
          status: rowStatus(next),
          messages: next as unknown as Prisma.InputJsonValue,
          correctedValues: hasCorrections ? (corrected as Prisma.InputJsonValue) : Prisma.DbNull,
          correctedById: actor.userId,
          correctedAt: new Date(),
        },
      });
      await this.recheckFile(tx, locked);
      await this.audit.record(
        {
          ...auditBase(actor),
          action: 'import.row.correct',
          resourceType: 'import_row_result',
          resourceId: rowId,
          // Field names only: never voter data.
          metadata: {
            importFileId: fileId,
            fields: changed,
            ...(dto.rejected !== undefined && dto.rejected !== wasRejected
              ? { rejected: dto.rejected }
              : {}),
          },
        },
        tx,
      );
    });
    const [row] = await this.load([rowId]);
    return row!;
  }

  /** Checks that need other rows: a corrected EPIC that another row of the file has. */
  private async reviewChecks(
    tx: Tx,
    fileId: string,
    rowId: string,
    current: RowValues,
    corrected: RowValues,
  ): Promise<RowMessage[]> {
    if (!('epic' in corrected) || typeof current.epic !== 'string') return [];
    const [{ count }] = await tx.$queryRaw<[{ count: number }]>`
      SELECT count(*)::int AS count FROM import_row_result
      WHERE import_file_id = ${fileId}::uuid AND id <> ${rowId}::uuid AND status <> 'rejected'
        AND COALESCE(corrected_values->>'epic', extracted_values->>'epic') = ${current.epic}`;
    return count > 0
      ? [
          {
            code: 'epic.duplicate',
            severity: 'warning',
            message: 'Another row of this roll has the same EPIC number',
            field: 'epic',
            source: 'review',
          },
        ]
      : [];
  }

  /**
   * The totals check and open errors decide the file's status after a
   * review change: `ready` when the counts match the printed totals and no
   * row or header error is left, else `needs_review`.
   */
  private async recheckFile(
    tx: Tx,
    file: { id: string; batchId: string; status: ImportFileStatus } & TotalsSource,
  ): Promise<void> {
    const rows = await tx.importRowResult.findMany({
      where: { importFileId: file.id },
      select: ROW_SELECT,
    });
    const detected = (file.detectedHeader ?? {}) as DetectedHeader;
    // Totals issues are re-checked here; any other header error still needs a person.
    const headerErrors = (detected.issues ?? []).some(
      (i) => i.severity === 'error' && !i.code.startsWith('totals.'),
    );
    const rowErrors = rows.some((r) => hasOpenError(r.status, normaliseMessages(r.messages)));
    const status: ImportFileStatus =
      totals(file, rows).matches && !rowErrors && !headerErrors ? 'ready' : 'needs_review';
    if (status !== file.status) {
      await tx.importFile.update({ where: { id: file.id }, data: { status } });
      await refreshBatchStatus(tx, file.batchId);
    }
  }

  private async rows(
    fileId: string,
    query: PreviewQuery,
  ): Promise<Page<ReviewRow> & { total: number }> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const filters: Prisma.Sql[] = [Prisma.sql`r.import_file_id = ${fileId}::uuid`];
    if (query.status?.length) {
      filters.push(Prisma.sql`r.status::text IN (${Prisma.join(query.status)})`);
    }
    if (query.lowConfidence) {
      // A corrected field has been checked by a person, so it no longer counts.
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM jsonb_each(r.field_confidence) c
        WHERE jsonb_typeof(c.value) = 'number' AND (c.value #>> '{}')::float8 < ${LOW_CONFIDENCE}
          AND NOT (COALESCE(r.corrected_values, '{}'::jsonb) ? c.key))`);
    }
    const where = Prisma.join(filters, ' AND ');
    const [{ total }] = await this.prisma.$queryRaw<[{ total: number }]>`
      SELECT count(*)::int AS total FROM import_row_result r WHERE ${where}`;
    let after = Prisma.sql`TRUE`;
    if (query.cursor) {
      const { p, b } = decodeCursor(
        query.cursor,
        (v): v is { p: number; b: number } => typeof v.p === 'number' && typeof v.b === 'number',
      );
      after = Prisma.sql`(r.page, r.box_index) > (${p}, ${b})`;
    }
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM import_row_result r WHERE ${where} AND ${after}
      ORDER BY r.page, r.box_index LIMIT ${limit + 1}`;
    const page = toPage(await this.load(ids.map((r) => r.id)), limit, (row) =>
      encodeCursor({ p: row.page, b: row.boxIndex }),
    );
    return { ...page, total };
  }

  /** Rows by id, in roll order, as the review shows them. */
  private async load(ids: string[]): Promise<ReviewRow[]> {
    const rows = await this.prisma.importRowResult.findMany({
      where: { id: { in: ids } },
      include: { correctedBy: { select: { id: true, name: true } } },
      orderBy: [{ page: 'asc' }, { boxIndex: 'asc' }],
    });
    return rows.map((row) => {
      const corrected = (row.correctedValues as RowValues | null) ?? null;
      const extracted = currentValues(row.extractedValues as RowValues, row.sectionNo, null);
      return {
        id: row.id,
        page: row.page,
        boxIndex: row.boxIndex,
        sectionNo: row.sectionNo,
        serialNo: row.serialNo,
        status: row.status,
        messages: normaliseMessages(row.messages),
        rawText: row.rawText,
        extracted,
        confidence: row.fieldConfidence as Record<string, number | null>,
        corrected,
        current: { ...extracted, ...(corrected ?? {}) },
        correctedBy: row.correctedBy,
        correctedAt: row.correctedAt,
      };
    });
  }

  /** Rows per file and status, and the voters they would become. */
  private async rowCounts(where: Prisma.Sql) {
    // Active voters: not rejected, not marked deleted; gender as corrected.
    const counted = await this.prisma.$queryRaw<
      {
        fileId: string;
        status: ImportRowStatus;
        rows: number;
        voters: number;
        male: number;
        female: number;
        thirdGender: number;
      }[]
    >`
      SELECT "fileId", status, count(*)::int AS rows,
        (count(*) FILTER (WHERE active))::int AS voters,
        (count(*) FILTER (WHERE active AND gender = 'male'))::int AS male,
        (count(*) FILTER (WHERE active AND gender = 'female'))::int AS female,
        (count(*) FILTER (WHERE active AND gender = 'third_gender'))::int AS "thirdGender"
      FROM (
        SELECT r.import_file_id AS "fileId", r.status::text AS status,
          r.status <> 'rejected' AND COALESCE(
            CASE WHEN r.corrected_values ? 'marker' THEN r.corrected_values->>'marker'
                 ELSE r.extracted_values->>'marker' END, '') <> 'deleted' AS active,
          CASE WHEN r.corrected_values ? 'gender' THEN r.corrected_values->>'gender'
               ELSE r.extracted_values->>'gender' END AS gender
        FROM import_row_result r JOIN import_file f ON f.id = r.import_file_id
        WHERE ${where}
      ) rows
      GROUP BY 1, 2`;
    const byFile = new Map<string, CountedRows>();
    for (const c of counted) {
      const entry = byFile.get(c.fileId) ?? emptyCounts();
      entry.rows[c.status] = c.rows;
      entry.rowCount += c.rows;
      entry.voterCount += c.voters;
      entry.current.male += c.male;
      entry.current.female += c.female;
      entry.current.thirdGender += c.thirdGender;
      entry.current.total += c.voters;
      byFile.set(c.fileId, entry);
    }
    return byFile;
  }

  private async fileInScope(scope: Scope, fileId: string) {
    const file = await this.prisma.importFile.findUnique({
      where: { id: fileId },
      include: { batch: true, partNode: true },
    });
    if (!file || !(await this.nodeInScope(scope, file.batch.targetNodeId))) {
      throw notFound('Import file');
    }
    return file;
  }

  private nodeInScope(scope: Scope, nodeId: string) {
    return this.prisma.geographyNode.findFirst({
      where: { id: nodeId, ancestors: { some: { ancestorId: { in: scope.nodeIds } } } },
      select: { id: true },
    });
  }
}

interface RowCounts {
  rowCount: number;
  rows: Record<ImportRowStatus, number>;
  voterCount: number;
}

/** The row counts, and the active voters by gender (for the totals check). */
interface CountedRows extends RowCounts {
  current: ElectorCounts;
}

const emptyCounts = (): CountedRows => ({
  rowCount: 0,
  rows: { accepted: 0, warning: 0, rejected: 0 },
  voterCount: 0,
  current: { male: 0, female: 0, thirdGender: 0, total: 0 },
});

interface TotalsSource {
  detectedHeader: Prisma.JsonValue;
  printedTotals: Prisma.JsonValue;
  extractedTotals: Prisma.JsonValue;
}

function totals(
  file: TotalsSource,
  rows: {
    status: ImportRowStatus;
    extractedValues: Prisma.JsonValue;
    correctedValues: Prisma.JsonValue;
    sectionNo: number | null;
  }[],
): TotalsCheck {
  const current = countVoters(
    rows.map((r) => ({
      status: r.status,
      current: currentValues(
        r.extractedValues as RowValues,
        r.sectionNo,
        r.correctedValues as RowValues | null,
      ),
    })),
  );
  return totalsCheck(
    printedCounts(file.printedTotals),
    (file.extractedTotals as ElectorCounts | null) ?? null,
    current,
  );
}

function voterPages(detected: DetectedHeader): PageImage[] {
  return (detected.pageImages ?? []).filter((p) => p.kind === 'voters');
}

function fileView(
  file: {
    id: string;
    originalName: string;
    sizeBytes: bigint;
    status: ImportFileStatus;
    duplicateOfId: string | null;
    error: Prisma.JsonValue;
    detectedHeader: Prisma.JsonValue;
    partNode: { id: string; code: string; name: string } | null;
    pageCount: number | null;
    qualityScore: number | null;
    printedTotals: Prisma.JsonValue;
    extractedAt: Date | null;
    confirmedAt: Date | null;
  },
  { current, ...counts }: CountedRows = emptyCounts(),
): FileStatusView {
  const printed = printedCounts(file.printedTotals);
  const detected = (file.detectedHeader ?? {}) as DetectedHeader;
  const error = file.error as { code?: string; message?: string } | null;
  return {
    id: file.id,
    originalName: file.originalName,
    sizeBytes: Number(file.sizeBytes),
    status: file.status,
    duplicateOfId: file.duplicateOfId,
    error: error ? { code: error.code ?? 'unknown', message: error.message ?? '' } : null,
    part: file.partNode
      ? { id: file.partNode.id, code: file.partNode.code, name: file.partNode.name }
      : null,
    proposedPart: detected.matching?.proposedPart ?? null,
    pageCount: file.pageCount,
    ...counts,
    qualityScore: file.qualityScore,
    totalsMatch: printed ? totalsCheck(printed, null, current).matches : null,
    extractedAt: file.extractedAt,
    confirmedAt: file.confirmedAt,
  };
}

const CSV_BATCH = 500;
const CSV_FIELDS = [
  'epic',
  'name',
  'relationType',
  'relativeName',
  'houseNumber',
  'age',
  'gender',
  'marker',
] as const;
const CSV_COLUMNS = [
  'page',
  'box',
  'section',
  'serial',
  'status',
  ...CSV_FIELDS,
  'corrections',
  'messages',
];

/** One exported row: values as extracted, corrections as `field=value`, messages as `code: text`. */
function csvRow(row: {
  page: number;
  boxIndex: number;
  sectionNo: number | null;
  serialNo: number | null;
  status: ImportRowStatus;
  extractedValues: Prisma.JsonValue;
  correctedValues: Prisma.JsonValue;
  messages: Prisma.JsonValue;
}): unknown[] {
  const extracted = (row.extractedValues ?? {}) as RowValues;
  const corrected = (row.correctedValues ?? {}) as RowValues;
  const corrections = Object.entries(corrected)
    .map(([field, value]) => `${field}=${value === null ? '' : String(value as string | number)}`)
    .join('; ');
  const messages = normaliseMessages(row.messages)
    .map((m) => `${m.code}: ${m.message}${m.resolved ? ' (resolved)' : ''}`)
    .join(' | ');
  return [
    row.page,
    row.boxIndex,
    row.sectionNo,
    row.serialNo,
    row.status,
    ...CSV_FIELDS.map((f) => extracted[f]),
    corrections,
    messages,
  ];
}
