import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { seesRestricted as canSeeRestricted } from '../authz/restricted-fields';
import type { Scope } from '../authz/scope.service';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import {
  type FieldEntity,
  type FieldType,
  type HouseholdStatus,
  Prisma,
  type RecordOrigin,
  type ValueSource,
  type VisitOutcome,
  type VoterRecordStatus,
} from '../generated/prisma/client';

export const DEFAULT_SYNC_LIMIT = 500;
export const MAX_SYNC_LIMIT = 2000;

export interface SyncFieldDefinition {
  id: string;
  key: string;
  labelKey: string;
  appliesTo: FieldEntity;
  type: FieldType;
  options: Prisma.JsonValue;
  isRestricted: boolean;
  requiresConsent: boolean;
  /** False: the field is no longer collected; hide it and its values. */
  enabled: boolean;
  purpose: string;
}

export interface SyncHousehold {
  id: string;
  partId: string;
  pollingStationId: string;
  displayAddress: string;
  houseKey: string;
  structuredAddress: Prisma.JsonValue;
  location: { lat: number; lng: number; accuracyM: number | null; capturedAt: Date | null } | null;
  origin: RecordOrigin;
  /** `removed`: no longer in the roll; drop it from the list. */
  status: HouseholdStatus;
}

export interface SyncVoter {
  id: string;
  householdId: string;
  partId: string;
  pollingStationId: string;
  origin: RecordOrigin;
  /** Anything but `active`: drop it from the household. */
  recordStatus: VoterRecordStatus;
  sectionNo: number | null;
  serialNo: number | null;
  epicNumber: string | null;
  official: Prisma.JsonValue;
}

export interface SyncFieldValue {
  /** The `base_version` for the next edit of this field. */
  id: string;
  entityType: FieldEntity;
  entityId: string;
  fieldKey: string;
  value: Prisma.JsonValue;
  sourceType: ValueSource;
  collectedBy: { id: string; name: string } | null;
  collectedAt: Date;
  supersedesId: string | null;
  /** False once another value replaced it. */
  isCurrent: boolean;
  conflictWithId: string | null;
}

export interface SyncVisit {
  id: string;
  clientId: string;
  householdId: string;
  volunteerId: string;
  startedAt: Date;
  completedAt: Date | null;
  outcome: VisitOutcome;
  formVersion: string;
  notes: string | null;
  correctsVisitId: string | null;
  memberIdsMet: string[];
}

/** Two current values of one field, waiting for the volunteer to choose one. */
export interface SyncConflict {
  entityType: FieldEntity;
  entityId: string;
  fieldKey: string;
  /** The newer value (the one that arrived second) first. */
  values: [SyncFieldValue, SyncFieldValue];
}

export interface SyncPage {
  /** True when this is a full snapshot: replace everything stored on the phone. */
  reset: boolean;
  fieldDefinitions: SyncFieldDefinition[];
  households: SyncHousehold[];
  voters: SyncVoter[];
  fieldValues: SyncFieldValue[];
  visits: SyncVisit[];
  /** Last page only: values to delete because their consent was withdrawn. */
  removedFieldValueIds: string[];
  /** Last page only: every open conflict on the caller's booths. */
  conflicts: SyncConflict[];
  /** More pages follow: call again with `since=cursor` straight away. */
  hasMore: boolean;
  /** Pass as `since`: the next page, or (when `hasMore` is false) the next pull. */
  cursor: string;
}

const PHASES = ['fieldDefinitions', 'households', 'voters', 'fieldValues', 'visits'] as const;

/**
 * A database snapshot, as far as sync needs it: every transaction below
 * `x` (xmax) had finished, except the ones in `r` (still running). A row
 * written by a transaction the snapshot could not see has change_xid >= x or
 * in r. Transaction IDs are strings (bigint in JSON).
 */
interface Snap extends Record<string, unknown> {
  x: string;
  r: string[];
}

/** The cursor, opaque to clients. */
interface SyncCursor extends Record<string, unknown> {
  v: 1;
  /** Send what this snapshot could not see; null for a full snapshot. */
  s: Snap | null;
  /** While paging: the snapshot taken on the first page, where the next pull starts. */
  n?: Snap;
  /** The phase being paged, and the last row sent in it. */
  p: number;
  x?: string;
  i?: string;
  /** Scope fingerprint: a different scope restarts with a full snapshot. */
  h: string;
}

const DIGITS = /^\d{1,20}$/;
const isSnap = (s: unknown): s is Snap =>
  !!s &&
  typeof s === 'object' &&
  typeof (s as Snap).x === 'string' &&
  DIGITS.test((s as Snap).x) &&
  Array.isArray((s as Snap).r) &&
  (s as Snap).r.length <= 500 &&
  (s as Snap).r.every((xid) => typeof xid === 'string' && DIGITS.test(xid));
const isSyncCursor = (c: Record<string, unknown>): c is SyncCursor =>
  c.v === 1 &&
  (c.s === null || isSnap(c.s)) &&
  (c.n === undefined || isSnap(c.n)) &&
  typeof c.p === 'number' &&
  Number.isInteger(c.p) &&
  c.p >= 0 &&
  c.p < PHASES.length &&
  (c.x === undefined || (typeof c.x === 'string' && DIGITS.test(c.x))) &&
  (c.i === undefined || typeof c.i === 'string') &&
  typeof c.h === 'string';

interface Position {
  xid: bigint;
  id: string;
}

interface FieldValueRow {
  id: string;
  entityType: FieldEntity;
  entityId: string;
  fieldKey: string;
  value: Prisma.JsonValue;
  sourceType: ValueSource;
  collectedById: string | null;
  collectedByName: string | null;
  collectedAt: Date;
  supersedesId: string | null;
  isCurrent: boolean;
  conflictWithId: string | null;
  sortXid: bigint;
}

/**
 * Offline sync, server to phone (plan §4). A pull returns what changed on
 * the caller's booths since the cursor; with no cursor, a full snapshot. See
 * migration 20260928160000_sync_change_marker for why the cursor holds a
 * database snapshot rather than a timestamp.
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async pull(scope: Scope, since: string | undefined, limit: number): Promise<SyncPage> {
    const seesRestricted = canSeeRestricted(scope);
    const fingerprint = createHash('sha256')
      .update(`${[...scope.boothIds].sort().join(',')}|${seesRestricted}`)
      .digest('base64url')
      .slice(0, 16);

    let cursor = since ? decodeCursor(since, isSyncCursor) : null;
    // New booths or roles: the phone's copy may hold data it may no longer see.
    if (cursor && cursor.h !== fingerprint) cursor = null;
    const reset = !cursor || cursor.s === null;
    // Taken before reading anything: whatever this pull might miss, the
    // snapshot can't have seen, so the next pull sends it.
    const next = cursor?.n ?? (await this.snapshot());

    const ctx: Context = {
      scope,
      seesRestricted,
      since: cursor?.s ? { xmax: BigInt(cursor.s.x), running: cursor.s.r } : null,
      programIds: await this.programIds(scope),
    };
    const page: SyncPage = {
      reset,
      fieldDefinitions: [],
      households: [],
      voters: [],
      fieldValues: [],
      visits: [],
      removedFieldValueIds: [],
      conflicts: [],
      hasMore: false,
      cursor: '',
    };

    let phase = cursor?.p ?? 0;
    let after: Position | null =
      cursor?.x !== undefined && cursor.i !== undefined
        ? { xid: BigInt(cursor.x), id: cursor.i }
        : null;
    let remaining = limit;
    while (phase < PHASES.length && remaining > 0) {
      const { rows, last } = await this.fetch(PHASES[phase]!, ctx, after, remaining + 1);
      const taken = rows.slice(0, remaining);
      (page[PHASES[phase]!] as unknown[]).push(...taken);
      if (rows.length > remaining) {
        after = last(taken.length - 1);
        break;
      }
      remaining -= taken.length;
      phase += 1;
      after = null;
    }

    const common = { v: 1 as const, h: fingerprint };
    if (phase < PHASES.length) {
      page.hasMore = true;
      page.cursor = encodeCursor({
        ...common,
        s: cursor?.s ?? null,
        n: next,
        p: phase,
        ...(after ? { x: after.xid.toString(), i: after.id } : {}),
      } satisfies SyncCursor);
      return page;
    }

    if (ctx.since) page.removedFieldValueIds = await this.withdrawn(ctx);
    page.conflicts = await this.conflicts(ctx);
    page.cursor = encodeCursor({ ...common, s: next, p: 0 } satisfies SyncCursor);
    return page;
  }

  private async snapshot(): Promise<Snap> {
    const [row] = await this.prisma.$queryRaw<{ x: string; r: string[] }[]>`
      SELECT pg_snapshot_xmax(s)::text AS x,
             ARRAY(SELECT xid::text FROM pg_snapshot_xip(s) AS xid) AS r
      FROM pg_current_snapshot() AS s`;
    return { x: row!.x, r: row!.r };
  }

  private async programIds(scope: Scope): Promise<string[]> {
    const nodes = await this.prisma.geographyNode.findMany({
      where: { id: { in: scope.boothIds } },
      select: { programId: true },
      distinct: ['programId'],
    });
    return nodes.map((node) => node.programId);
  }

  private async fetch(
    phase: (typeof PHASES)[number],
    ctx: Context,
    after: Position | null,
    take: number,
  ): Promise<{ rows: unknown[]; last: (index: number) => Position }> {
    const keyset = after
      ? { OR: [{ changeXid: { gt: after.xid } }, { changeXid: after.xid, id: { gt: after.id } }] }
      : {};
    const changed = ctx.since
      ? {
          OR: [
            { changeXid: { gte: ctx.since.xmax } },
            { changeXid: { in: ctx.since.running.map(BigInt) } },
          ],
        }
      : {};
    // Both conditions are ORs, so they go in AND rather than being spread.
    const window = { AND: [changed, keyset] };
    const order = [{ changeXid: 'asc' as const }, { id: 'asc' as const }];
    const positions = <T extends { id: string; changeXid: bigint }>(rows: T[]) => ({
      last: (index: number) => ({ xid: rows[index]!.changeXid, id: rows[index]!.id }),
    });

    switch (phase) {
      case 'fieldDefinitions': {
        const rows = await this.prisma.fieldDefinition.findMany({
          where: {
            programId: { in: ctx.programIds },
            ...(ctx.seesRestricted ? {} : { isRestricted: false }),
            ...(ctx.since === null ? { enabled: true } : {}),
            ...window,
          },
          orderBy: order,
          take,
        });
        return {
          rows: rows.map((d) => ({
            id: d.id,
            key: d.key,
            labelKey: d.labelKey,
            appliesTo: d.appliesTo,
            type: d.type,
            options: d.options,
            isRestricted: d.isRestricted,
            requiresConsent: d.requiresConsent,
            enabled: d.enabled,
            purpose: d.purpose,
          })),
          ...positions(rows),
        };
      }
      case 'households': {
        const rows = await this.prisma.household.findMany({
          where: {
            pollingStationId: { in: ctx.scope.boothIds },
            ...(ctx.since === null ? { status: 'active' as const } : {}),
            ...window,
          },
          orderBy: order,
          take,
        });
        return { rows: rows.map(toSyncHousehold), ...positions(rows) };
      }
      case 'voters': {
        const rows = await this.prisma.voter.findMany({
          where: {
            pollingStationId: { in: ctx.scope.boothIds },
            ...(ctx.since === null ? { recordStatus: 'active' as const } : {}),
            ...window,
          },
          orderBy: order,
          take,
        });
        return {
          rows: rows.map((v) => ({
            id: v.id,
            householdId: v.householdId,
            partId: v.partId,
            pollingStationId: v.pollingStationId,
            origin: v.origin,
            recordStatus: v.recordStatus,
            sectionNo: v.sectionNo,
            serialNo: v.serialNo,
            epicNumber: v.sourceVoterId,
            official: v.sourceData,
          })),
          ...positions(rows),
        };
      }
      case 'visits': {
        const rows = await this.prisma.visit.findMany({
          where: {
            household: { pollingStationId: { in: ctx.scope.boothIds } },
            ...window,
          },
          orderBy: order,
          take,
          include: { membersMet: { select: { voterId: true }, orderBy: { voterId: 'asc' } } },
        });
        return {
          rows: rows.map((v) => ({
            id: v.id,
            clientId: v.clientId,
            householdId: v.householdId,
            volunteerId: v.volunteerId,
            startedAt: v.startedAt,
            completedAt: v.completedAt,
            outcome: v.outcome,
            formVersion: v.formVersion,
            notes: v.notes,
            correctsVisitId: v.correctsVisitId,
            memberIdsMet: v.membersMet.map((m) => m.voterId),
          })),
          ...positions(rows),
        };
      }
      case 'fieldValues': {
        const rows = await this.fieldValues(ctx, after, take);
        return {
          rows: rows.map(toSyncFieldValue),
          last: (index: number) => ({ xid: rows[index]!.sortXid, id: rows[index]!.id }),
        };
      }
    }
  }

  /**
   * Values on the caller's booths of fields they may see; consent-gated ones
   * only while the consent is granted. A value also counts as changed when
   * its consent changed.
   */
  private fieldValues(ctx: Context, after: Position | null, take: number) {
    const sortXid = Prisma.sql`GREATEST(fv.change_xid, COALESCE(c.change_xid, 0))`;
    return this.prisma.$queryRaw<FieldValueRow[]>`
      SELECT fv.id, fv.entity_type AS "entityType", fv.entity_id AS "entityId", fd.key AS "fieldKey",
             fv.value, fv.source_type AS "sourceType", fv.collected_by AS "collectedById",
             u.name AS "collectedByName", fv.collected_at AS "collectedAt",
             fv.supersedes_id AS "supersedesId", fv.is_current AS "isCurrent",
             fv.conflict_with_id AS "conflictWithId", ${sortXid} AS "sortXid"
      FROM field_value fv
      ${visibleValueJoins}
      WHERE ${visibleValue(ctx)}
        AND (fd.requires_consent = false OR c.status = 'granted')
        AND ${
          ctx.since === null
            ? Prisma.sql`fv.is_current`
            : Prisma.sql`(${changedSince(Prisma.sql`fv.change_xid`, ctx.since)}
                OR ${changedSince(Prisma.sql`c.change_xid`, ctx.since)})`
        }
        AND ${after ? Prisma.sql`(${sortXid}, fv.id) > (${after.xid}, ${after.id}::uuid)` : Prisma.sql`true`}
      ORDER BY ${sortXid}, fv.id
      LIMIT ${take}`;
  }

  /** Values hidden since the cursor because their consent was withdrawn. */
  private async withdrawn(ctx: Context): Promise<string[]> {
    if (!ctx.since) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT fv.id FROM field_value fv
      ${visibleValueJoins}
      WHERE ${visibleValue(ctx)}
        AND fd.requires_consent AND c.status <> 'granted'
        AND ${changedSince(Prisma.sql`c.change_xid`, ctx.since)}
      ORDER BY fv.id`;
    return rows.map((row) => row.id);
  }

  /** Every open conflict: a current value marked as conflicting with another. */
  private async conflicts(ctx: Context): Promise<SyncConflict[]> {
    const rows = await this.prisma.$queryRaw<(FieldValueRow & { pairId: string })[]>`
      SELECT pair.id AS "pairId", x.id, x.entity_type AS "entityType", x.entity_id AS "entityId",
             fd.key AS "fieldKey", x.value, x.source_type AS "sourceType",
             x.collected_by AS "collectedById", xu.name AS "collectedByName",
             x.collected_at AS "collectedAt", x.supersedes_id AS "supersedesId",
             x.is_current AS "isCurrent", x.conflict_with_id AS "conflictWithId", 0::bigint AS "sortXid"
      FROM field_value fv
      ${visibleValueJoins}
      JOIN LATERAL (VALUES (fv.id, 0), (fv.conflict_with_id, 1)) AS pair(id, n) ON true
      JOIN field_value x ON x.id = pair.id
      LEFT JOIN app_user xu ON xu.id = x.collected_by
      WHERE ${visibleValue(ctx)}
        AND fv.is_current AND fv.conflict_with_id IS NOT NULL
        AND (fd.requires_consent = false OR c.status = 'granted')
      ORDER BY fv.id, pair.n`;
    const conflicts: SyncConflict[] = [];
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const [newer, older] = [rows[i]!, rows[i + 1]!];
      conflicts.push({
        entityType: newer.entityType,
        entityId: newer.entityId,
        fieldKey: newer.fieldKey,
        values: [toSyncFieldValue(newer), toSyncFieldValue(older)],
      });
    }
    return conflicts;
  }
}

interface Context {
  scope: Scope;
  seesRestricted: boolean;
  /** Send rows this snapshot couldn't see; null for a full snapshot. */
  since: { xmax: bigint; running: string[] } | null;
  programIds: string[];
}

/** Written by a transaction the cursor's snapshot couldn't see. */
const changedSince = (column: Prisma.Sql, since: NonNullable<Context['since']>) =>
  Prisma.sql`(${column} >= ${since.xmax} OR ${column} = ANY(${since.running}::bigint[]))`;

const visibleValueJoins = Prisma.sql`
  JOIN field_definition fd ON fd.id = fv.field_definition_id
  LEFT JOIN consent c ON c.id = fv.consent_id
  LEFT JOIN app_user u ON u.id = fv.collected_by
  LEFT JOIN voter v ON fv.entity_type = 'voter' AND v.id = fv.entity_id
  LEFT JOIN household h ON fv.entity_type = 'household' AND h.id = fv.entity_id`;

/** On the caller's booths, of an enabled field they may see. */
const visibleValue = (ctx: Context) => Prisma.sql`
  COALESCE(v.polling_station_id, h.polling_station_id) = ANY(${ctx.scope.boothIds}::uuid[])
  AND fd.enabled
  AND ${ctx.seesRestricted ? Prisma.sql`true` : Prisma.sql`fd.is_restricted = false`}`;

function toSyncFieldValue(row: FieldValueRow): SyncFieldValue {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    fieldKey: row.fieldKey,
    value: row.value,
    sourceType: row.sourceType,
    collectedBy:
      row.collectedById && row.collectedByName
        ? { id: row.collectedById, name: row.collectedByName }
        : null,
    collectedAt: row.collectedAt,
    supersedesId: row.supersedesId,
    isCurrent: row.isCurrent,
    conflictWithId: row.conflictWithId,
  };
}

function toSyncHousehold(h: {
  id: string;
  partId: string;
  pollingStationId: string;
  displayAddress: string;
  houseKey: string;
  structuredAddress: Prisma.JsonValue;
  locationLat: Prisma.Decimal | null;
  locationLng: Prisma.Decimal | null;
  locationAccuracyM: number | null;
  locationCapturedAt: Date | null;
  origin: RecordOrigin;
  status: HouseholdStatus;
}): SyncHousehold {
  return {
    id: h.id,
    partId: h.partId,
    pollingStationId: h.pollingStationId,
    displayAddress: h.displayAddress,
    houseKey: h.houseKey,
    structuredAddress: h.structuredAddress,
    location:
      h.locationLat !== null && h.locationLng !== null
        ? {
            lat: h.locationLat.toNumber(),
            lng: h.locationLng.toNumber(),
            accuracyM: h.locationAccuracyM,
            capturedAt: h.locationCapturedAt,
          }
        : null,
    origin: h.origin,
    status: h.status,
  };
}
