import { Injectable } from '@nestjs/common';

import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  escapeLike,
  type Page,
  toPage,
} from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { type GeographyNodeType, Prisma } from '../generated/prisma/client';

export interface GeographyNodeView {
  id: string;
  parentId: string | null;
  type: GeographyNodeType;
  code: string;
  name: string;
  isAuxiliary: boolean;
  /** States, PCs and ACs: reservation status (GEN, SC, ST…), if recorded. */
  reservation: string | null;
}

export interface GeographyNodeDetail extends GeographyNodeView {
  /** From the top (state) down to the node's parent, for breadcrumbs. */
  path: GeographyNodeView[];
}

interface Position extends Record<string, unknown> {
  code: string;
  id: string;
}
const isPosition = (value: Record<string, unknown>): value is Position =>
  typeof value.code === 'string' && typeof value.id === 'string';

// A node is visible when it is one of the caller's assigned nodes, below one
// (what they work on) or above one (the path down to it, for dropdowns and
// breadcrumbs). Siblings of their areas, like another booth, are not. An
// admin of a State manages the program's whole State → PC → AC list (#100),
// so they also see every State, PC and AC of that program (#103).
function visible(scope: Scope): Prisma.Sql {
  const assigned =
    scope.nodeIds.length > 0 ? scope.nodeIds : ['00000000-0000-0000-0000-000000000000'];
  return Prisma.sql`(
    EXISTS (SELECT 1 FROM geography_closure c
            WHERE c.descendant_id = n.id AND c.ancestor_id = ANY(${assigned}::uuid[]))
    OR EXISTS (SELECT 1 FROM geography_closure c
               WHERE c.ancestor_id = n.id AND c.descendant_id = ANY(${assigned}::uuid[]))
    OR (n.type IN ('state', 'pc', 'ac') AND EXISTS (
      SELECT 1 FROM role_assignment ra JOIN geography_node sn ON sn.id = ra.geography_node_id
      WHERE ra.user_id = ${scope.userId}::uuid AND ra.role = 'admin' AND sn.type = 'state'
        AND sn.program_id = n.program_id
        AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())))
  )`;
}

const COLUMNS = Prisma.sql`n.id, n.parent_id AS "parentId", n.type, n.code, n.name,
  n.is_auxiliary AS "isAuxiliary", n.metadata->>'reservation' AS reservation`;

@Injectable()
export class GeographyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Direct children of `parentId` (or the top-level nodes), limited to what
   * the caller may see. Ordered naturally by code (shorter codes first, so
   * part 2 comes before part 10), then by ID; `q` matches the start of the
   * code or any part of the name.
   */
  async list(
    scope: Scope,
    query: {
      parentId?: string;
      type?: GeographyNodeType;
      q?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<Page<GeographyNodeView>> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const conditions: Prisma.Sql[] = [
      query.parentId
        ? Prisma.sql`n.parent_id = ${query.parentId}::uuid`
        : Prisma.sql`n.parent_id IS NULL`,
      visible(scope),
    ];
    if (query.type) conditions.push(Prisma.sql`n.type = ${query.type}::geography_node_type`);
    if (query.q) {
      const q = escapeLike(query.q.trim());
      conditions.push(Prisma.sql`(n.code ILIKE ${`${q}%`} OR n.name ILIKE ${`%${q}%`})`);
    }
    if (query.cursor) {
      const after = decodeCursor(query.cursor, isPosition);
      conditions.push(
        Prisma.sql`(length(n.code), n.code, n.id) > (${after.code.length}, ${after.code}, ${after.id}::uuid)`,
      );
    }

    const rows = await this.prisma.$queryRaw<GeographyNodeView[]>`
      SELECT ${COLUMNS} FROM geography_node n
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY length(n.code), n.code, n.id
      LIMIT ${limit + 1}`;
    return toPage(rows, limit, (row) => encodeCursor({ code: row.code, id: row.id }));
  }

  /** One node and its path from the top; 404 when the caller may not see it. */
  async get(scope: Scope, id: string): Promise<GeographyNodeDetail> {
    const [node] = await this.prisma.$queryRaw<GeographyNodeView[]>`
      SELECT ${COLUMNS} FROM geography_node n
      WHERE n.id = ${id}::uuid AND ${visible(scope)}`;
    if (!node) throw notFound('Geography node');

    const path = await this.prisma.$queryRaw<GeographyNodeView[]>`
      SELECT ${COLUMNS} FROM geography_closure c
      JOIN geography_node n ON n.id = c.ancestor_id
      WHERE c.descendant_id = ${id}::uuid AND c.depth > 0
      ORDER BY c.depth DESC`;
    return { ...node, path };
  }
}
