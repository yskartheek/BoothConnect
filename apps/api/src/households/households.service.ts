import { Injectable } from '@nestjs/common';

import type { Scope } from '../authz/scope.service';
import { foundInScope, inScope } from '../authz/scoped-query';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  escapeLike,
  type Page,
  toPage,
} from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import {
  type HouseholdStatus,
  Prisma,
  type RecordOrigin,
  type VisitOutcome,
} from '../generated/prisma/client';

/** Visit status, from the household's latest effective visit (spec §7.3). */
export const VISIT_STATUSES = ['not_visited', 'visited', 'follow_up'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export interface HouseholdSummary {
  id: string;
  partId: string;
  pollingStationId: string;
  displayAddress: string;
  houseKey: string;
  origin: RecordOrigin;
  /** Active members (official and volunteer-added). */
  voterCount: number;
  lastVisit: { outcome: VisitOutcome; startedAt: Date } | null;
}

/** A member as shown on the household screen: current values over the roll's. */
export interface MemberSummary {
  id: string;
  origin: RecordOrigin;
  sectionNo: number | null;
  serialNo: number | null;
  /** EPIC number; null for volunteer-added members. */
  epicNumber: string | null;
  name: string | null;
  age: number | null;
  gender: string | null;
  relationType: string | null;
  relativeName: string | null;
  /** Two offline edits of one of this member's fields collided (plan §4). */
  hasConflict: boolean;
}

export interface HouseholdDetail {
  id: string;
  partId: string;
  pollingStationId: string;
  displayAddress: string;
  houseKey: string;
  structuredAddress: Prisma.JsonValue;
  /** Captured with consent; null when there is none. */
  location: { lat: number; lng: number; accuracyM: number | null; capturedAt: Date | null } | null;
  origin: RecordOrigin;
  status: HouseholdStatus;
  /** Active members, in roll order; volunteer-added members last. */
  members: MemberSummary[];
  /** The latest visit that no later visit corrects. */
  lastVisit: {
    id: string;
    outcome: VisitOutcome;
    startedAt: Date;
    completedAt: Date | null;
    volunteerId: string;
    memberIdsMet: string[];
  } | null;
}

/** Summary fields a volunteer may have updated; restricted fields never appear here. */
const SUMMARY_FIELDS = ['name', 'age', 'gender'] as const;
type SummaryField = (typeof SUMMARY_FIELDS)[number];

interface SourceData {
  name?: unknown;
  age?: unknown;
  gender?: unknown;
  relationType?: unknown;
  relativeName?: unknown;
}
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

export interface ListHouseholdsQuery {
  boothId?: string;
  q?: string;
  status?: VisitStatus;
  limit?: number;
  cursor?: string;
}

interface Position extends Record<string, unknown> {
  id: string;
}
const isPosition = (value: Record<string, unknown>): value is Position =>
  typeof value.id === 'string';

interface Row extends Omit<HouseholdSummary, 'lastVisit'> {
  lastVisitOutcome: VisitOutcome | null;
  lastVisitAt: Date | null;
}

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active households at the caller's booths (optionally one booth), newest
   * UUIDv7 last, with keyset pagination on the ID. A `boothId` outside the
   * scope gives an empty page, the same as a booth with no households.
   */
  async list(scope: Scope, query: ListHouseholdsQuery): Promise<Page<HouseholdSummary>> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const booths = query.boothId
      ? scope.boothIds.filter((id) => id === query.boothId)
      : scope.boothIds;
    if (booths.length === 0) return { items: [], nextCursor: null };

    const conditions: Prisma.Sql[] = [
      Prisma.sql`h.polling_station_id = ANY(${booths}::uuid[])`,
      Prisma.sql`h.status = 'active'`,
    ];
    if (query.status === 'not_visited') conditions.push(Prisma.sql`lv.outcome IS NULL`);
    if (query.status === 'visited') conditions.push(Prisma.sql`lv.outcome IS NOT NULL`);
    if (query.status === 'follow_up') {
      conditions.push(Prisma.sql`lv.outcome = 'follow_up_requested'`);
    }
    if (query.q) conditions.push(matches(query.q.trim()));
    if (query.cursor) {
      const after = decodeCursor(query.cursor, isPosition);
      conditions.push(Prisma.sql`h.id > ${after.id}::uuid`);
    }

    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT h.id, h.part_id AS "partId", h.polling_station_id AS "pollingStationId",
             h.display_address AS "displayAddress", h.house_key AS "houseKey", h.origin,
             (SELECT count(*)::int FROM voter v
               WHERE v.household_id = h.id AND v.record_status = 'active') AS "voterCount",
             lv.outcome AS "lastVisitOutcome", lv.started_at AS "lastVisitAt"
      FROM household h
      LEFT JOIN LATERAL (
        -- The latest visit that no later visit corrects.
        SELECT v.outcome, v.started_at FROM visit v
        WHERE v.household_id = h.id
          AND NOT EXISTS (SELECT 1 FROM visit c WHERE c.corrects_visit_id = v.id)
        ORDER BY v.started_at DESC, v.id DESC
        LIMIT 1
      ) lv ON true
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY h.id
      LIMIT ${limit + 1}`;

    const page = toPage(rows, limit, (row) => encodeCursor({ id: row.id }));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ lastVisitOutcome, lastVisitAt, ...household }) => ({
        ...household,
        lastVisit:
          lastVisitOutcome && lastVisitAt
            ? { outcome: lastVisitOutcome, startedAt: lastVisitAt }
            : null,
      })),
    };
  }
  /** One household with its members and last visit; 404 outside the scope. */
  async get(scope: Scope, id: string): Promise<HouseholdDetail> {
    const household = foundInScope(
      await this.prisma.household.findFirst({ where: { id, ...inScope(scope) } }),
      'Household',
    );

    const [voters, lastVisit] = await Promise.all([
      this.prisma.voter.findMany({
        where: { householdId: id, recordStatus: 'active' },
        orderBy: [
          { sectionNo: { sort: 'asc', nulls: 'last' } },
          { serialNo: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      }),
      this.prisma.visit.findFirst({
        where: { householdId: id, correctedBy: { is: null } },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        include: { membersMet: { select: { voterId: true }, orderBy: { voterId: 'asc' } } },
      }),
    ]);

    const values = await this.prisma.fieldValue.findMany({
      where: {
        entityType: 'voter',
        entityId: { in: voters.map((voter) => voter.id) },
        isCurrent: true,
      },
      select: {
        entityId: true,
        value: true,
        conflictWithId: true,
        fieldDefinition: { select: { key: true } },
      },
      // Later values win below; ties (a conflict) resolve to the newest.
      orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
    });
    const current = new Map<string, Partial<Record<SummaryField, unknown>>>();
    const conflicted = new Set<string>();
    for (const row of values) {
      if (row.conflictWithId) conflicted.add(row.entityId);
      const key = row.fieldDefinition.key as SummaryField;
      if (!SUMMARY_FIELDS.includes(key)) continue;
      current.set(row.entityId, { ...current.get(row.entityId), [key]: row.value });
    }

    return {
      id: household.id,
      partId: household.partId,
      pollingStationId: household.pollingStationId,
      displayAddress: household.displayAddress,
      houseKey: household.houseKey,
      structuredAddress: household.structuredAddress,
      location:
        household.locationLat !== null && household.locationLng !== null
          ? {
              lat: household.locationLat.toNumber(),
              lng: household.locationLng.toNumber(),
              accuracyM: household.locationAccuracyM,
              capturedAt: household.locationCapturedAt,
            }
          : null,
      origin: household.origin,
      status: household.status,
      members: voters.map((voter) => {
        const source = (voter.sourceData ?? {}) as SourceData;
        const edited = current.get(voter.id) ?? {};
        const pick = (key: SummaryField) => (key in edited ? edited[key] : source[key]);
        return {
          id: voter.id,
          origin: voter.origin,
          sectionNo: voter.sectionNo,
          serialNo: voter.serialNo,
          epicNumber: voter.sourceVoterId,
          name: text(pick('name')),
          age: num(pick('age')),
          gender: text(pick('gender')),
          relationType: text(source.relationType),
          relativeName: text(source.relativeName),
          hasConflict: conflicted.has(voter.id),
        };
      }),
      lastVisit: lastVisit && {
        id: lastVisit.id,
        outcome: lastVisit.outcome,
        startedAt: lastVisit.startedAt,
        completedAt: lastVisit.completedAt,
        volunteerId: lastVisit.volunteerId,
        memberIdsMet: lastVisit.membersMet.map((member) => member.voterId),
      },
    };
  }
}

/**
 * Search: part of the address, the start of the house number, a member's
 * name (as printed in the roll, or the current value a volunteer entered) or
 * the start of an EPIC number. Case-insensitive; `%` and `_` are literal.
 */
function matches(q: string): Prisma.Sql {
  const text = escapeLike(q);
  const anywhere = `%${text}%`;
  const prefix = `${text}%`;
  return Prisma.sql`(
    h.display_address ILIKE ${anywhere}
    OR h.house_key ILIKE ${prefix}
    OR EXISTS (
      SELECT 1 FROM voter v
      WHERE v.household_id = h.id AND v.record_status = 'active'
        AND (v.source_data->>'name' ILIKE ${anywhere} OR v.source_voter_id ILIKE ${prefix}
             OR EXISTS (
               SELECT 1 FROM field_value fv
               JOIN field_definition fd ON fd.id = fv.field_definition_id AND fd.key = 'name'
               WHERE fv.entity_type = 'voter' AND fv.entity_id = v.id AND fv.is_current
                 AND fv.value #>> '{}' ILIKE ${anywhere})))
  )`;
}
