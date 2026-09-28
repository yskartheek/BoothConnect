import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { inScope } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { toApiError } from '../common/errors/all-exceptions.filter';
import { ErrorCode } from '../common/errors/error-codes';
import { fieldErrors } from '../common/errors/validation';
import type { Env } from '../config/env';
import { ConflictsService } from '../conflicts/conflicts.service';
import { PrismaService } from '../database/prisma.service';
import { FieldValuesService } from '../field-values/field-values.service';
import type { FieldEntity, Prisma } from '../generated/prisma/client';
import { HouseholdWritesService } from '../households/household-writes.service';
import { requestHash } from '../idempotency/request-hash';
import { VisitsService } from '../visits/visits.service';
import {
  type ConflictResolvePayload,
  type ConsentCapturePayload,
  type FieldChangePayload,
  type HouseholdUpdatePayload,
  type MemberCreatePayload,
  type MutationDto,
  type MutationType,
  PAYLOADS,
} from './push.dto';
import type { CreateHouseholdDto } from '../households/dto';
import type { CreateVisitDto } from '../visits/dto';

type Tx = Prisma.TransactionClient;

/** A field's current value(s), sent back with a conflict. */
export interface CurrentValue {
  id: string;
  value: Prisma.JsonValue;
  collectedBy: { id: string; name: string } | null;
  collectedAt: Date;
}

export interface MutationResult {
  key: string;
  type: MutationType;
  /**
   * applied: stored. duplicate: this change was already stored (resent
   * item, or a record with this client id exists); `result` is what it
   * was. conflict: stored, but the field had moved on (`current` has the
   * server's values; resolve it with conflict.resolve). rejected: nothing
   * stored (`code`, `message`).
   */
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  result?: unknown;
  current?: CurrentValue[];
  code?: string;
  message?: string;
  details?: unknown;
}

/** What an item's handler reports; `stored` is replayed on a resend. */
interface Outcome {
  status: 'applied' | 'duplicate' | 'conflict';
  result: unknown;
  current?: CurrentValue[];
}

class Rejected extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const ITEM_KEY_PREFIX = 'sync-push:';

/**
 * Offline sync, phone to server (plan §4): a batch of queued changes, applied
 * in order, each in its own transaction with its own result. Later items can
 * refer to households, members and consents created by earlier ones through
 * the ids the phone made up. Each item has its own key: resending it (in this
 * batch or a later one) gives `duplicate` and stores nothing again.
 */
@Injectable()
export class SyncPushService {
  private readonly logger = new Logger(SyncPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly fieldValues: FieldValuesService,
    private readonly visits: VisitsService,
    private readonly households: HouseholdWritesService,
    private readonly conflicts: ConflictsService,
  ) {}

  async push(scope: Scope, actor: Actor, mutations: MutationDto[]): Promise<MutationResult[]> {
    const results: MutationResult[] = [];
    for (const mutation of mutations) results.push(await this.pushOne(scope, actor, mutation));
    return results;
  }

  private async pushOne(
    scope: Scope,
    actor: Actor,
    mutation: MutationDto,
  ): Promise<MutationResult> {
    const { key, type } = mutation;
    const base = { key, type };
    const payload = plainToInstance(PAYLOADS[type] as new () => object, mutation.payload);
    const errors = await validate(payload, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      return {
        ...base,
        status: 'rejected',
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Payload validation failed',
        details: fieldErrors(errors),
      };
    }

    const recordKey = `${ITEM_KEY_PREFIX}${key}`;
    const hash = requestHash('PUSH', type, mutation.payload);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // One writer per item key, so a batch sent twice at once stores it once.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push:${actor.userId}:${key}`}, 0))`;
        const stored = await tx.idempotencyRecord.findUnique({
          where: { userId_key: { userId: actor.userId, key: recordKey } },
        });
        if (stored && stored.expiresAt > new Date()) {
          if (stored.requestHash !== hash) {
            throw new Rejected(
              ErrorCode.IDEMPOTENCY_KEY_REUSED,
              'This key was already used for a different change',
            );
          }
          return { ...base, status: 'duplicate' as const, result: stored.response };
        }
        if (stored) await tx.idempotencyRecord.delete({ where: { id: stored.id } });

        const outcome = await this.apply(tx, scope, actor, type, payload);
        const result = toJson(outcome.result);
        const ttl = this.config.get('IDEMPOTENCY_TTL_SECONDS', { infer: true });
        await tx.idempotencyRecord.create({
          data: {
            userId: actor.userId,
            key: recordKey,
            requestHash: hash,
            statusCode: HttpStatus.OK,
            response: result as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + ttl * 1000),
          },
        });
        return {
          ...base,
          status: outcome.status,
          result,
          ...(outcome.current ? { current: toJson(outcome.current) as CurrentValue[] } : {}),
        };
      });
    } catch (error) {
      if (error instanceof Rejected) {
        return {
          ...base,
          status: 'rejected',
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        };
      }
      const api = toApiError(error);
      if (api.status >= 500) this.logger.error(`sync push item ${type} failed`, error as Error);
      return {
        ...base,
        status: 'rejected',
        code: api.code,
        message: api.message,
        ...(api.details === undefined ? {} : { details: api.details }),
      };
    }
  }

  private async apply(
    tx: Tx,
    scope: Scope,
    actor: Actor,
    type: MutationType,
    payload: object,
  ): Promise<Outcome> {
    switch (type) {
      case 'visit.create': {
        const visit = await this.visits.create(scope, actor, payload as CreateVisitDto, tx);
        return { status: visit.duplicate ? 'duplicate' : 'applied', result: visit };
      }
      case 'field.change':
        return this.fieldChange(tx, scope, actor, payload as FieldChangePayload);
      case 'consent.capture':
        return this.consentCapture(tx, scope, actor, payload as ConsentCapturePayload);
      case 'household.create': {
        const household = await this.households.create(
          scope,
          actor,
          payload as CreateHouseholdDto,
          tx,
        );
        return { status: household.duplicate ? 'duplicate' : 'applied', result: household };
      }
      case 'household.update': {
        const { id, ...dto } = payload as HouseholdUpdatePayload;
        const updated = await this.households.update(scope, actor, id, dto, tx);
        const fields = Object.entries(updated.results);
        const conflicted = fields.filter(([, r]) => r?.status === 'conflict');
        if (fields.length > 0 && fields.every(([, r]) => r?.status === 'rejected')) {
          throw new Rejected(ErrorCode.UNPROCESSABLE, 'No field could be saved', updated.results);
        }
        if (conflicted.length === 0) return { status: 'applied', result: updated };
        const current = [];
        for (const [name] of conflicted) {
          const key = name === 'address' ? 'address' : 'household_location';
          current.push(...(await currentValues(tx, 'household', id, key)));
        }
        return { status: 'conflict', result: updated, current };
      }
      case 'member.create': {
        const { householdId, ...dto } = payload as MemberCreatePayload;
        const member = await this.households.addMember(scope, actor, householdId, dto, tx);
        return { status: member.duplicate ? 'duplicate' : 'applied', result: member };
      }
      case 'conflict.resolve': {
        const { conflictId, keepFieldValueId } = payload as ConflictResolvePayload;
        const resolution = await this.conflicts.resolveIn(
          tx,
          scope,
          actor,
          conflictId,
          keepFieldValueId,
        );
        if (resolution.status === 'rejected') {
          throw new Rejected(resolution.code, resolution.message);
        }
        return {
          status: resolution.status === 'resolved' ? 'applied' : 'duplicate',
          result: resolution,
        };
      }
    }
  }

  private async fieldChange(
    tx: Tx,
    scope: Scope,
    actor: Actor,
    change: FieldChangePayload,
  ): Promise<Outcome> {
    const [result] = await this.fieldValues.write(
      scope,
      actor.userId,
      [
        {
          entityType: change.entityType,
          entityId: change.entityId,
          fieldKey: change.fieldKey,
          value: change.value as Prisma.InputJsonValue,
          baseVersion: change.baseVersion,
          consentId: change.consentId,
          collectedAt: change.collectedAt ? new Date(change.collectedAt) : undefined,
        },
      ],
      tx,
    );
    if (!result || result.status === 'rejected') {
      throw new Rejected(result?.code ?? ErrorCode.UNPROCESSABLE, result?.message ?? 'Not saved');
    }
    await this.audit.record(
      {
        action: 'field.change',
        resourceType: change.entityType,
        resourceId: change.entityId,
        result: 'success',
        actorId: actor.userId,
        sessionId: actor.sessionId ?? null,
        requestId: actor.requestId ?? null,
        metadata: { fieldKey: change.fieldKey, status: result.status, via: 'sync.push' },
      },
      tx,
    );
    if (result.status === 'applied') return { status: 'applied', result };
    return {
      status: 'conflict',
      result,
      current: await currentValues(tx, change.entityType, change.entityId, change.fieldKey),
    };
  }

  private async consentCapture(
    tx: Tx,
    scope: Scope,
    actor: Actor,
    consent: ConsentCapturePayload,
  ): Promise<Outcome> {
    if (!!consent.voterId === !!consent.householdId) {
      throw new Rejected(ErrorCode.VALIDATION_FAILED, 'Give exactly one of voterId or householdId');
    }
    const subject = consent.voterId
      ? await tx.voter.findFirst({ where: { id: consent.voterId, ...inScope(scope) } })
      : await tx.household.findFirst({ where: { id: consent.householdId, ...inScope(scope) } });
    if (!subject) throw new Rejected(ErrorCode.NOT_FOUND, 'Person or household not found');

    if (consent.id) {
      const existing = await tx.consent.findUnique({ where: { id: consent.id } });
      if (existing) {
        const same =
          existing.subjectVoterId === (consent.voterId ?? null) &&
          existing.subjectHouseholdId === (consent.householdId ?? null) &&
          existing.purpose === consent.purpose;
        if (!same) throw new Rejected(ErrorCode.CONFLICT, 'id is already used');
        return { status: 'duplicate', result: { id: existing.id } };
      }
    }
    const created = await tx.consent.create({
      data: {
        ...(consent.id ? { id: consent.id } : {}),
        subjectVoterId: consent.voterId ?? null,
        subjectHouseholdId: consent.householdId ?? null,
        purpose: consent.purpose,
        noticeVersion: consent.noticeVersion,
        capturedMethod: consent.method,
        capturedById: actor.userId,
        capturedAt: consent.capturedAt ? new Date(consent.capturedAt) : new Date(),
      },
    });
    await this.audit.record(
      {
        action: 'consent.capture',
        resourceType: consent.voterId ? 'voter' : 'household',
        resourceId: consent.voterId ?? consent.householdId ?? null,
        result: 'success',
        actorId: actor.userId,
        sessionId: actor.sessionId ?? null,
        requestId: actor.requestId ?? null,
        metadata: { consentId: created.id, purpose: created.purpose },
      },
      tx,
    );
    return { status: 'applied', result: { id: created.id } };
  }
}

/** The field's current value(s): after a conflict, both clashing values. */
async function currentValues(
  tx: Tx,
  entityType: FieldEntity,
  entityId: string,
  fieldKey: string,
): Promise<CurrentValue[]> {
  const rows = await tx.fieldValue.findMany({
    where: { entityType, entityId, isCurrent: true, fieldDefinition: { key: fieldKey } },
    include: { collectedBy: { select: { id: true, name: true } } },
    orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    id: row.id,
    value: row.value,
    collectedBy: row.collectedBy,
    collectedAt: row.collectedAt,
  }));
}

/** Dates as ISO strings, as the response and the stored record carry them. */
const toJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
