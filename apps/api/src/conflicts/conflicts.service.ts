import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { PrismaService } from '../database/prisma.service';
import { type ConflictResolution, FieldValuesService } from '../field-values/field-values.service';
import type { Prisma } from '../generated/prisma/client';

export type ConflictResolved = Exclude<ConflictResolution, { status: 'rejected' }>;

/** "Choose value" (ADR 0003): the volunteer keeps one of two clashing values. */
@Injectable()
export class ConflictsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldValues: FieldValuesService,
    private readonly audit: AuditService,
  ) {}

  /** Its own transaction; a rejection becomes 404 (not found or not visible) or 409. */
  async resolve(
    scope: Scope,
    actor: Actor,
    conflictId: string,
    keepFieldValueId: string,
  ): Promise<ConflictResolved> {
    const result = await this.prisma.$transaction((tx) =>
      this.resolveIn(tx, scope, actor, conflictId, keepFieldValueId),
    );
    if (result.status === 'rejected') {
      throw new AppException(
        result.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT,
        result.code,
        result.message,
      );
    }
    return result;
  }

  /** The resolution and its audit event, in the caller's transaction. */
  async resolveIn(
    tx: Prisma.TransactionClient,
    scope: Scope,
    actor: Actor,
    conflictId: string,
    keepFieldValueId: string,
  ): Promise<ConflictResolution> {
    const result = await this.fieldValues.resolveConflict(scope, conflictId, keepFieldValueId, tx);
    if (result.status === 'resolved') {
      await this.audit.record(
        {
          action: 'conflict.resolve',
          resourceType: result.entityType,
          resourceId: result.entityId,
          result: 'success',
          actorId: actor.userId,
          sessionId: actor.sessionId ?? null,
          requestId: actor.requestId ?? null,
          metadata: {
            fieldKey: result.fieldKey,
            keptId: result.keptId,
            discardedIds: result.discardedIds,
          },
        },
        tx,
      );
    }
    return result;
  }
}
