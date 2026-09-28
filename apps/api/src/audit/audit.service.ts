import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import type { AuditResult, Prisma } from '../generated/prisma/client';
import { redact } from './redact';

export interface AuditEntry {
  /** e.g. "auth.login", "auth.logout", "household.update". */
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  /** Null for system events (workers, scheduled jobs). */
  actorId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  /** Context only (e.g. a reason code). Redacted before it is stored. */
  metadata?: Record<string, unknown>;
}

/**
 * Writes the append-only, hash-chained audit log (spec §14). The database
 * assigns seq, links each event to the previous one and computes its hash
 * under an advisory lock, so concurrent writes still form one linear chain
 * (migration 20260927160100_idempotency_audit). Events can't be changed or
 * deleted.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        result: entry.result,
        actorId: entry.actorId ?? null,
        sessionId: entry.sessionId ?? null,
        requestId: entry.requestId ?? null,
        metadata: redact(entry.metadata ?? {}) as Prisma.InputJsonObject,
      },
    });
  }

  /**
   * Recomputes the whole chain. Returns null when it is intact, otherwise the
   * seq of the first event whose link or hash doesn't match.
   */
  async verifyChain(): Promise<bigint | null> {
    const [row] = await this.prisma.$queryRaw<{ broken: bigint | null }[]>`
      SELECT audit_verify_chain() AS broken`;
    return row?.broken ?? null;
  }
}
