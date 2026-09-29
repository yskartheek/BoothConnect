import {
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import type { ImportFileStatus, Prisma } from '../generated/prisma/client';
import { refreshBatchStatus } from './batch-status';
import {
  coverageOf,
  mostCommon,
  houseKeyOf,
  type Preparation,
  prepareVoters,
  type StationChoice,
  stationFor,
  type VoterRow,
} from './confirm-rules';
import type { HeaderMatch } from './extraction/results.service';
import { auditBase } from './imports.service';
import { countVoters, currentValues, printedCounts, type RowValues } from './review-rules';
import { NodeStatsRefresh } from '../analytics/stats-refresh';

type Tx = Prisma.TransactionClient;

interface DetectedHeader {
  header?: {
    acNumber?: unknown;
    partNumber?: unknown;
    revisionYear?: unknown;
    revisionType?: unknown;
    mainTown?: unknown;
    pollingStation?: { number?: unknown; name?: unknown; address?: unknown } | null;
    auxiliaryStations?: { number?: unknown; name?: unknown; address?: unknown }[];
  } | null;
  matching?: HeaderMatch;
}

export interface ConfirmQueued {
  id: string;
  status: ImportFileStatus;
  /** Voters the file will add. */
  voters: number;
}

export interface BatchConfirmResult {
  queued: ConfirmQueued[];
  /** Ready files that couldn't be confirmed, and why. */
  skipped: { id: string; code: string; message: string }[];
}

/** What a committed file changed (counts only). */
export interface CommitSummary {
  sourceVersionId: string;
  previousVersionId: string | null;
  partCreated: boolean;
  stationsCreated: number;
  householdsCreated: number;
  householdsLinked: number;
  householdsRemoved: number;
  voters: number;
  votersSuperseded: number;
  rowsRejected: number;
  rowsDeleted: number;
}

class ConfirmRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const VOTER_CHUNK = 500;

/**
 * Roll imports, step 4 (#47; design §3 "Confirm"): an admin confirms a
 * reviewed file (or every ready file of a batch), and a background job
 * commits it to the active dataset, one transaction per file:
 *
 * 1. the part and its polling stations, linked or created from the header;
 * 2. a new `source_version` after the part's current one (which is kept,
 *    with its voters marked `superseded`);
 * 3. households by house number (existing ones are linked, official ones no
 *    longer listed are marked `removed`), and one voter per accepted row
 *    with its corrections applied, at the main station or the auxiliary
 *    station covering its section or serial.
 *
 * The queue is the file's own status (`confirming`), claimed with
 * `FOR UPDATE SKIP LOCKED`, so a confirm is never lost and never committed
 * twice, even with several API instances. Files are picked up right away and
 * by a sweep every IMPORT_RESULTS_SWEEP_SECONDS (e.g. after a restart).
 */
@Injectable()
export class ImportConfirmService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportConfirmService.name);
  private timer?: NodeJS.Timeout;
  private draining: Promise<void> | null = null;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stats: NodeStatsRefresh,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const every = this.config.get('IMPORT_RESULTS_SWEEP_SECONDS', { infer: true }) * 1000;
    this.timer = setInterval(() => this.kick(), every);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    await this.draining;
  }

  /** Confirms one file: `ready`, or `needs_review` once every row error is dealt with. */
  async confirmFile(
    scope: Scope,
    actor: Actor,
    fileId: string,
    acceptTotalsMismatch: boolean,
  ): Promise<ConfirmQueued> {
    const file = await this.prisma.importFile.findUnique({
      where: { id: fileId },
      include: { batch: true },
    });
    if (!file || !(await this.nodeInScope(scope, file.batch.targetNodeId))) {
      throw notFound('Import file');
    }
    let queued: ConfirmQueued;
    try {
      queued = await this.prisma.$transaction((tx) =>
        this.queue(tx, actor, fileId, acceptTotalsMismatch),
      );
    } catch (error) {
      if (error instanceof ConfirmRefused) throw refusal(error);
      throw error;
    }
    this.kick();
    return queued;
  }

  /** Confirms every `ready` file of a batch; the others are left for review. */
  async confirmBatch(scope: Scope, actor: Actor, batchId: string): Promise<BatchConfirmResult> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch || !(await this.nodeInScope(scope, batch.targetNodeId))) throw notFound('Batch');
    const ready = await this.prisma.importFile.findMany({
      where: { batchId, status: 'ready' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (ready.length === 0) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.UNPROCESSABLE,
        'No file in this batch is ready to confirm',
      );
    }
    const result: BatchConfirmResult = { queued: [], skipped: [] };
    for (const { id } of ready) {
      try {
        // One transaction per file: one bad file doesn't hold back the rest.
        result.queued.push(
          await this.prisma.$transaction((tx) => this.queue(tx, actor, id, false)),
        );
      } catch (error) {
        if (!(error instanceof ConfirmRefused)) throw error;
        result.skipped.push({ id, code: error.code, message: error.message });
      }
    }
    if (result.queued.length > 0) {
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { confirmedById: actor.userId, confirmedAt: new Date() },
      });
    }
    this.kick();
    return result;
  }

  /** Checks a file can be committed, then marks it `confirming`. */
  private async queue(
    tx: Tx,
    actor: Actor,
    fileId: string,
    acceptTotalsMismatch: boolean,
  ): Promise<ConfirmQueued> {
    await tx.$queryRaw`SELECT id FROM import_file WHERE id = ${fileId}::uuid FOR UPDATE`;
    const file = await tx.importFile.findUniqueOrThrow({ where: { id: fileId } });
    if (file.status === 'confirming' || file.status === 'confirmed') {
      throw new ConfirmRefused('file.already_confirmed', 'This file has already been confirmed');
    }
    if (file.status !== 'ready' && file.status !== 'needs_review') {
      throw new ConfirmRefused('file.not_reviewable', `A ${file.status} file can't be confirmed`);
    }
    const detected = (file.detectedHeader ?? {}) as DetectedHeader;
    if (
      !detected.header ||
      !detected.matching ||
      typeof detected.header.revisionYear !== 'number'
    ) {
      throw new ConfirmRefused(
        'header.incomplete',
        "The roll's cover page is incomplete (the revision year is missing)",
      );
    }
    const rows = await tx.importRowResult.findMany({ where: { importFileId: fileId } });
    const prepared = prepareVoters(rows);
    if (!prepared.ok) {
      throw new ConfirmRefused(prepared.code, prepared.message, {
        rowIds: prepared.rowIds.slice(0, 100),
        rows: prepared.rowIds.length,
      });
    }
    const printed = printedCounts(file.printedTotals);
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
    const totalsMatch =
      printed !== null &&
      (['male', 'female', 'thirdGender', 'total'] as const).every((k) => printed[k] === current[k]);
    if (!totalsMatch && !acceptTotalsMismatch) {
      throw new ConfirmRefused(
        'totals.mismatch',
        "The voters don't add up to the totals printed on the roll; review the rows, or confirm with acceptTotalsMismatch",
        { printed, current },
      );
    }
    await tx.importFile.update({
      where: { id: fileId },
      data: {
        status: 'confirming',
        confirmedById: actor.userId,
        confirmedAt: new Date(),
        error: undefined,
      },
    });
    await refreshBatchStatus(tx, file.batchId);
    await this.audit.record(
      {
        ...auditBase(actor),
        action: 'import.file.confirm',
        resourceType: 'import_file',
        resourceId: fileId,
        metadata: {
          voters: prepared.voters.length,
          ...(totalsMatch ? {} : { acceptTotalsMismatch: true }),
        },
      },
      tx,
    );
    return { id: fileId, status: 'confirming', voters: prepared.voters.length };
  }

  /** Starts committing confirmed files, unless that is already running. */
  kick(): void {
    if (this.closing || this.draining) return;
    this.draining = this.run()
      .catch((error: unknown) => this.logger.error('import confirm failed', error as Error))
      .finally(() => {
        this.draining = null;
      });
  }

  /** Waits until every confirmed file has been committed (or sent back to review). */
  async drain(): Promise<void> {
    await this.draining;
    await this.run();
  }

  private async run(): Promise<void> {
    while (!this.closing && (await this.commitNext())) {
      // next file
    }
  }

  /** Commits the next confirmed file; false when there is none. */
  async commitNext(): Promise<boolean> {
    let claimed: string | null = null;
    try {
      const outcome = await this.prisma.$transaction(
        async (tx) => {
          const [next] = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM import_file WHERE status = 'confirming'
            ORDER BY confirmed_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
          if (!next) return null;
          claimed = next.id;
          return this.commit(tx, next.id);
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      if (!outcome) return false;
      await this.stats.request(outcome.nodeIds).catch((error: unknown) => {
        this.logger.warn(`stats refresh request failed: ${(error as Error).message}`);
      });
      this.logger.log(`import file ${claimed}: committed (${outcome.summary.voters} voters)`);
      return true;
    } catch (error) {
      if (!claimed) throw error;
      await this.fail(claimed, error);
      return true;
    }
  }

  private async commit(
    tx: Tx,
    fileId: string,
  ): Promise<{ summary: CommitSummary; nodeIds: string[] }> {
    const file = await tx.importFile.findUniqueOrThrow({
      where: { id: fileId },
      include: { batch: true },
    });
    const detected = (file.detectedHeader ?? {}) as DetectedHeader;
    const header = detected.header!;
    const rows = await tx.importRowResult.findMany({
      where: { importFileId: fileId },
      orderBy: [{ page: 'asc' }, { boxIndex: 'asc' }],
    });
    const prepared: Preparation = prepareVoters(rows);
    // Checked on confirm; a row can't change while the file is confirming.
    if (!prepared.ok) throw new ConfirmRefused(prepared.code, prepared.message);

    const ac = await this.acOf(tx, file.batch.targetNodeId, file.programId, header.acNumber);
    const partCode = text(header.partNumber) ?? detected.matching?.proposedPart?.code;
    if (!partCode) throw new ConfirmRefused('header.incomplete', 'The part number is missing');
    // Two files for the same part (e.g. two revisions) are committed one at a time.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import-part:${ac.id}:${partCode}`}))`;

    const { part, created: partCreated } = await this.partOf(tx, file, ac.id, partCode, detected);
    const {
      main,
      stations,
      created: stationsCreated,
    } = await this.stationsOf(tx, file.programId, part, detected);

    const previous = await tx.sourceVersion.findFirst({
      where: { partNodeId: part.id, nextVersion: { is: null } },
      orderBy: { createdAt: 'desc' },
    });
    const revisionType = text(header.revisionType) ?? 'Unknown revision';
    const version = await tx.sourceVersion.create({
      data: {
        programId: file.programId,
        partNodeId: part.id,
        revisionYear: header.revisionYear as number,
        revisionType,
        rollIdentification: revisionType,
        checksum: file.checksum,
        previousVersionId: previous?.id ?? null,
      },
    });

    // The previous revision stays for audit and comparison; its voters leave the active set.
    const superseded = await tx.voter.updateMany({
      where: { partId: part.id, origin: 'official_import', recordStatus: 'active' },
      data: { recordStatus: 'superseded' },
    });

    const voters = prepared.voters.map((voter) => ({
      ...voter,
      stationId: stationFor(main, stations, voter.sectionNo, voter.serialNo),
    }));
    const households = await this.households(tx, part.id, version.id, voters);

    for (let i = 0; i < voters.length; i += VOTER_CHUNK) {
      await tx.voter.createMany({
        data: voters.slice(i, i + VOTER_CHUNK).map((voter) => ({
          programId: file.programId,
          householdId: households.idByKey.get(keyOf(voter))!,
          partId: part.id,
          pollingStationId: voter.stationId,
          origin: 'official_import' as const,
          sectionNo: voter.sectionNo,
          serialNo: voter.serialNo,
          sourceVoterId: voter.epic,
          sourceData: voter.sourceData as Prisma.InputJsonValue,
          sourceVersionId: version.id,
          importFileId: file.id,
        })),
      });
    }

    await tx.importFile.update({
      where: { id: file.id },
      data: { status: 'confirmed', sourceVersionId: version.id, partNodeId: part.id },
    });
    await refreshBatchStatus(tx, file.batchId);
    const summary: CommitSummary = {
      sourceVersionId: version.id,
      previousVersionId: previous?.id ?? null,
      partCreated,
      stationsCreated,
      householdsCreated: households.created,
      householdsLinked: households.linked,
      householdsRemoved: households.removed,
      voters: voters.length,
      votersSuperseded: superseded.count,
      rowsRejected: prepared.skipped.rejected,
      rowsDeleted: prepared.skipped.deleted,
    };
    await this.audit.record(
      {
        action: 'import.file.committed',
        resourceType: 'import_file',
        resourceId: file.id,
        result: 'success',
        // Counts and ids only: never voter data.
        metadata: { ...summary, partNodeId: part.id },
      },
      tx,
    );
    return { summary, nodeIds: [part.id, ...new Set(voters.map((v) => v.stationId))] };
  }

  /** The roll's AC: on the batch target's path, or under the target. */
  private async acOf(tx: Tx, targetNodeId: string, programId: string, acNumber: unknown) {
    const code = text(acNumber);
    const ac = code
      ? await tx.geographyNode.findFirst({
          where: {
            programId,
            type: 'ac',
            code,
            OR: [
              { ancestors: { some: { ancestorId: targetNodeId } } },
              { descendants: { some: { descendantId: targetNodeId } } },
            ],
          },
        })
      : null;
    if (!ac) throw new ConfirmRefused('header.ac_unknown', 'The AC is not in the master data');
    return ac;
  }

  private async partOf(
    tx: Tx,
    file: { partNodeId: string | null; programId: string },
    acId: string,
    code: string,
    detected: DetectedHeader,
  ) {
    const existing = file.partNodeId
      ? await tx.geographyNode.findUniqueOrThrow({ where: { id: file.partNodeId } })
      : // Proposed on extraction; another file may have created it since.
        await tx.geographyNode.findFirst({ where: { parentId: acId, type: 'part', code } });
    if (existing) return { part: existing, created: false };
    const town = text(detected.header?.mainTown);
    const part = await tx.geographyNode.create({
      data: {
        programId: file.programId,
        parentId: acId,
        type: 'part',
        code,
        name: detected.matching?.proposedPart?.name ?? town ?? `Part ${code}`,
        metadata: town ? { mainTown: town } : {},
      },
    });
    return { part, created: true };
  }

  /** The printed stations, linked or created; the main one first. */
  private async stationsOf(
    tx: Tx,
    programId: string,
    part: { id: string; code: string },
    detected: DetectedHeader,
  ): Promise<{ main: string; stations: StationChoice[]; created: number }> {
    const header = detected.header;
    const printed = [
      ...(header?.pollingStation ? [{ ...header.pollingStation, auxiliary: false }] : []),
      ...(header?.auxiliaryStations ?? []).map((s) => ({ ...s, auxiliary: true })),
    ];
    let created = 0;
    for (const station of printed) {
      const code = text(station.number);
      if (!code) continue;
      const found = await tx.geographyNode.findFirst({
        where: { parentId: part.id, type: 'polling_station', code },
      });
      if (found) continue;
      const address = text(station.address);
      await tx.geographyNode.create({
        data: {
          programId,
          parentId: part.id,
          type: 'polling_station',
          code,
          name: text(station.name) ?? `Polling station ${code}`,
          isAuxiliary: station.auxiliary,
          metadata: address ? { address } : {},
        },
      });
      created += 1;
    }
    let children = await tx.geographyNode.findMany({
      where: { parentId: part.id, type: 'polling_station' },
      orderBy: { code: 'asc' },
    });
    if (!children.some((c) => !c.isAuxiliary)) {
      // No main station printed or known: every part has one (design §2).
      await tx.geographyNode.create({
        data: {
          programId,
          parentId: part.id,
          type: 'polling_station',
          code: part.code,
          name: `Polling station ${part.code}`,
        },
      });
      created += 1;
      children = await tx.geographyNode.findMany({
        where: { parentId: part.id, type: 'polling_station' },
        orderBy: { code: 'asc' },
      });
    }
    const mainCode = text(header?.pollingStation?.number);
    const main =
      children.find((c) => !c.isAuxiliary && c.code === mainCode) ??
      children.find((c) => !c.isAuxiliary)!;
    return {
      main: main.id,
      stations: children.map((c) => ({
        id: c.id,
        isAuxiliary: c.isAuxiliary,
        coverage: coverageOf(c.metadata),
      })),
      created,
    };
  }

  /**
   * One household per house number. An existing household of the part with
   * the same number is linked to the new revision (keeping what volunteers
   * recorded); official households the new revision no longer lists are
   * marked `removed`. Volunteer-added households are never removed.
   */
  private async households(
    tx: Tx,
    partId: string,
    sourceVersionId: string,
    voters: (VoterRow & { stationId: string })[],
  ) {
    const groups = new Map<string, (VoterRow & { stationId: string })[]>();
    for (const voter of voters) {
      const key = keyOf(voter);
      groups.set(key, [...(groups.get(key) ?? []), voter]);
    }
    const existing = new Map(
      (await tx.household.findMany({ where: { partId } })).map((h) => [h.houseKey, h]),
    );
    const idByKey = new Map<string, string>();
    const toCreate: Prisma.HouseholdCreateManyInput[] = [];
    let linked = 0;
    for (const [key, members] of groups) {
      const station = mostCommon(members.map((m) => m.stationId));
      const found = existing.get(key);
      if (found) {
        await tx.household.update({
          where: { id: found.id },
          data: {
            sourceVersionId,
            origin: 'official_import',
            status: 'active',
            pollingStationId: station,
          },
        });
        idByKey.set(key, found.id);
        linked += 1;
      } else {
        const houseNumber = members[0]!.houseNumber;
        toCreate.push({
          partId,
          pollingStationId: station,
          houseKey: key,
          displayAddress: houseNumber ?? 'No house number',
          structuredAddress: houseNumber ? { house_no: houseNumber } : {},
          sourceVersionId,
        });
      }
    }
    for (let i = 0; i < toCreate.length; i += VOTER_CHUNK) {
      const created = await tx.household.createManyAndReturn({
        data: toCreate.slice(i, i + VOTER_CHUNK),
        select: { id: true, houseKey: true },
      });
      for (const household of created) idByKey.set(household.houseKey, household.id);
    }
    const removed = await tx.household.updateMany({
      where: {
        partId,
        origin: 'official_import',
        status: 'active',
        houseKey: { notIn: [...groups.keys()] },
      },
      data: { status: 'removed' },
    });
    return { idByKey, created: toCreate.length, linked, removed: removed.count };
  }

  /** A commit that fails sends the file back to review, with the reason. */
  private async fail(fileId: string, error: unknown): Promise<void> {
    const refused = error instanceof ConfirmRefused ? error : null;
    // Database messages can quote values (e.g. an EPIC): log the kind only.
    this.logger.error(
      `import file ${fileId}: commit failed (${refused?.code ?? (error as Error).name})`,
    );
    const reason = refused
      ? { code: refused.code, message: refused.message }
      : {
          code: 'confirm_failed',
          message: 'The file could not be committed; try confirming again',
        };
    await this.prisma.$transaction(async (tx) => {
      const file = await tx.importFile.update({
        where: { id: fileId },
        data: { status: 'needs_review', confirmedAt: null, confirmedById: null, error: reason },
      });
      await refreshBatchStatus(tx, file.batchId);
      await this.audit.record(
        {
          action: 'import.file.committed',
          resourceType: 'import_file',
          resourceId: fileId,
          result: 'failure',
          metadata: { code: reason.code },
        },
        tx,
      );
    });
  }

  private nodeInScope(scope: Scope, nodeId: string) {
    return this.prisma.geographyNode.findFirst({
      where: { id: nodeId, ancestors: { some: { ancestorId: { in: scope.nodeIds } } } },
      select: { id: true },
    });
  }
}

/** The household a voter goes to: by house number, or one of their own. */
function keyOf(voter: VoterRow): string {
  return houseKeyOf(voter.houseNumber) ?? `~${voter.sectionNo}-${voter.serialNo}`;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function refusal(error: ConfirmRefused): AppException {
  const status =
    error.code === 'file.already_confirmed' || error.code === 'file.not_reviewable'
      ? HttpStatus.CONFLICT
      : HttpStatus.UNPROCESSABLE_ENTITY;
  return new AppException(
    status,
    status === HttpStatus.CONFLICT ? ErrorCode.CONFLICT : ErrorCode.UNPROCESSABLE,
    error.message,
    { reason: error.code, ...error.details },
  );
}
