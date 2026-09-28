import { Injectable } from '@nestjs/common';

import type { Scope } from '../authz/scope.service';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  escapeLike,
  type Page,
  toPage,
} from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { Prisma, type RecordOrigin, type VisitOutcome } from '../generated/prisma/client';

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
