import { HttpStatus, Injectable } from '@nestjs/common';

import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type Page,
  toPage,
} from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import type { AuditResult, Prisma } from '../generated/prisma/client';
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
    const where: Prisma.AuditEventWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action
        ? query.action.endsWith('*')
          ? { action: { startsWith: query.action.slice(0, -1) } }
          : { action: query.action }
        : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.result ? { result: query.result as AuditResult } : {}),
      ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(before !== null ? { seq: { lt: before } } : {}),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: limit + 1,
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
