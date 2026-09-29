import { HttpStatus, Injectable } from '@nestjs/common';

import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  escapeLike,
  type Page,
  toPage,
} from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { type AuditResult, Prisma } from '../generated/prisma/client';
import type { AuditEventsQuery } from './audit-events.dto';
import { AuditService } from './audit.service';

export interface AuditEventView {
  id: string;
  /** Position in the chain (a string: it can exceed JavaScript's safe integers). */
  seq: string;
  at: Date;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  actor: { id: string; name: string } | null;
  sessionId: string | null;
  requestId: string | null;
  metadata: Prisma.JsonValue;
  prevHash: string | null;
  hash: string;
}

export interface ChainCheck {
  /** Events checked: every event in the from/to range, whatever the other filters. */
  checked: number;
  intact: boolean;
  /** The first event whose hash or link to the previous event doesn't match. */
  firstBrokenSeq: string | null;
}

export type AuditEventsPage = Page<AuditEventView> & { verification?: ChainCheck };

/**
 * The audit log, for admins (#50; spec §14): filtered, newest first, with
 * cursor paging, and an optional check of the hash chain. Reading the log
 * is itself recorded (`audit.view`).
 */
@Injectable()
export class AuditEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, query: AuditEventsQuery): Promise<AuditEventsPage> {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (from && to && from >= to) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        '`from` must be before `to`',
      );
    }
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const before = query.cursor
      ? BigInt(
          decodeCursor(
            query.cursor,
            (v): v is { s: string } => typeof v.s === 'string' && /^\d+$/.test(v.s),
          ).s,
        )
      : null;
    if (
      query.nodeId &&
      !(await this.prisma.geographyNode.findUnique({ where: { id: query.nodeId } }))
    ) {
      throw notFound('Geography node');
    }
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.actorId) conditions.push(Prisma.sql`e.actor_id = ${query.actorId}::uuid`);
    if (query.action) {
      conditions.push(
        query.action.endsWith('*')
          ? Prisma.sql`e.action LIKE ${`${escapeLike(query.action.slice(0, -1))}%`}`
          : Prisma.sql`e.action = ${query.action}`,
      );
    }
    if (query.resourceType) conditions.push(Prisma.sql`e.resource_type = ${query.resourceType}`);
    if (query.resourceId) conditions.push(Prisma.sql`e.resource_id = ${query.resourceId}`);
    if (query.result) conditions.push(Prisma.sql`e.result = ${query.result}::audit_result`);
    if (from) conditions.push(Prisma.sql`e.at >= ${from}`);
    if (to) conditions.push(Prisma.sql`e.at < ${to}`);
    if (before !== null) conditions.push(Prisma.sql`e.seq < ${before}`);
    if (query.nodeId) conditions.push(inArea(query.nodeId));
    const seqs = await this.prisma.$queryRaw<{ seq: bigint }[]>`
      SELECT e.seq FROM audit_event e WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY e.seq DESC LIMIT ${limit + 1}`;
    const rows = await this.prisma.auditEvent.findMany({
      where: { seq: { in: seqs.map((r) => r.seq) } },
      orderBy: { seq: 'desc' },
      include: { actor: { select: { id: true, name: true } } },
    });
    const page = toPage(rows.map(view), limit, (e) => encodeCursor({ s: e.seq }));
    const verification = query.verify ? await this.verify(from, to) : undefined;

    await this.audit.record({
      action: 'audit.view',
      resourceType: 'audit_event',
      result: 'success',
      actorId: actor.userId,
      sessionId: actor.sessionId ?? null,
      requestId: actor.requestId ?? null,
      metadata: {
        filters: Object.fromEntries(
          Object.entries({
            actorId: query.actorId,
            action: query.action,
            resourceType: query.resourceType,
            resourceId: query.resourceId,
            result: query.result,
            nodeId: query.nodeId,
            from: query.from,
            to: query.to,
          }).filter(([, v]) => v !== undefined),
        ),
        returned: page.items.length,
        ...(verification ? { verified: verification.intact } : {}),
      },
    });
    return verification ? { ...page, verification } : page;
  }

  /**
   * Recomputes each event's hash in the range and checks its link to the
   * event just before it in the chain (which may be outside the range), so
   * an edited, inserted or deleted event is found.
   */
  private async verify(from: Date | null, to: Date | null): Promise<ChainCheck> {
    const rows = await this.prisma.$queryRaw<{ seq: bigint; ok: boolean }[]>`
      SELECT e.seq,
        (e.hash = audit_event_hash(e.prev_hash, e)
         AND e.prev_hash IS NOT DISTINCT FROM
           (SELECT p.hash FROM audit_event p WHERE p.seq < e.seq ORDER BY p.seq DESC LIMIT 1))
          AS ok
      FROM audit_event e
      WHERE (${from}::timestamptz IS NULL OR e.at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR e.at < ${to}::timestamptz)
      ORDER BY e.seq`;
    const broken = rows.find((r) => !r.ok);
    return {
      checked: rows.length,
      intact: !broken,
      firstBrokenSeq: broken ? broken.seq.toString() : null,
    };
  }
}

function view(e: {
  id: string;
  seq: bigint;
  at: Date;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  actor: { id: string; name: string } | null;
  sessionId: string | null;
  requestId: string | null;
  metadata: Prisma.JsonValue;
  prevHash: string | null;
  hash: string;
}): AuditEventView {
  return {
    id: e.id,
    seq: e.seq.toString(),
    at: e.at,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    result: e.result,
    actor: e.actor,
    sessionId: e.sessionId,
    requestId: e.requestId,
    metadata: e.metadata,
    prevHash: e.prevHash,
    hash: e.hash,
  };
}

/** A resource id that is a UUID, as a uuid; otherwise null (never matches). */
const asUuid = Prisma.sql`CASE WHEN e.resource_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN e.resource_id::uuid END`;

/**
 * Events that belong to an area (a booth, or any node above it): about a
 * household, member or visit at one of its booths, an import file of one of
 * its parts or an import batch opened for it or below; or by a volunteer
 * who was assigned in the area when the event happened.
 */
function inArea(nodeId: string): Prisma.Sql {
  const under = (column: Prisma.Sql) =>
    Prisma.sql`EXISTS (SELECT 1 FROM geography_closure c
                       WHERE c.ancestor_id = ${nodeId}::uuid AND c.descendant_id = ${column})`;
  return Prisma.sql`(
    (e.resource_type = 'household' AND EXISTS (
      SELECT 1 FROM household h WHERE h.id = ${asUuid} AND ${under(Prisma.sql`h.polling_station_id`)}))
    OR (e.resource_type = 'voter' AND EXISTS (
      SELECT 1 FROM voter v WHERE v.id = ${asUuid} AND ${under(Prisma.sql`v.polling_station_id`)}))
    OR (e.resource_type = 'visit' AND EXISTS (
      SELECT 1 FROM visit vi JOIN household h ON h.id = vi.household_id
      WHERE vi.id = ${asUuid} AND ${under(Prisma.sql`h.polling_station_id`)}))
    OR (e.resource_type = 'import_file' AND EXISTS (
      SELECT 1 FROM import_file f WHERE f.id = ${asUuid} AND ${under(Prisma.sql`f.part_node_id`)}))
    OR (e.resource_type = 'import_batch' AND EXISTS (
      SELECT 1 FROM import_batch b WHERE b.id = ${asUuid} AND ${under(Prisma.sql`b.target_node_id`)}))
    OR (e.actor_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM role_assignment r
      WHERE r.user_id = e.actor_id AND r.role = 'volunteer'
        AND r.valid_from <= e.at AND (r.valid_until IS NULL OR r.valid_until > e.at)
        AND ${under(Prisma.sql`r.geography_node_id`)}))
  )`;
}
