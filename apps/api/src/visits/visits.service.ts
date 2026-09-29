import { HttpStatus, Injectable } from '@nestjs/common';

import { NodeStatsRefresh } from '../analytics/stats-refresh';
import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { foundInScope, inScope } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../database/prisma.service';
import {
  type FieldChange,
  type FieldChangeResult,
  FieldValuesService,
} from '../field-values/field-values.service';
import type { Prisma, VisitOutcome } from '../generated/prisma/client';
import type { CreateVisitDto } from './dto';

/** How far ahead of the server clock a phone's timestamps may be. */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

export interface VisitCreated {
  id: string;
  clientId: string;
  householdId: string;
  outcome: VisitOutcome;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  /** The visit this one corrects; the corrected visit no longer counts. */
  correctsVisitId: string | null;
  /** True when a visit with this clientId was already stored; nothing was applied again. */
  duplicate: boolean;
  /** The consent records created, by the client's `ref`. */
  consents: { ref: string; id: string }[];
  /** One result per field change, in request order. */
  fieldChanges: FieldChangeResult[];
}

const unprocessable = (message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, message);

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldValues: FieldValuesService,
    private readonly audit: AuditService,
    private readonly stats: NodeStatsRefresh,
  ) {}

  /**
   * Stores a visit with the members met, any consents captured and any field
   * changes, all in one transaction together with its audit event. Visits are
   * append-only; each field change gets its own applied/conflict/rejected result.
   * Pass `outer` to run inside the caller's transaction (sync push).
   */
  async create(
    scope: Scope,
    actor: Actor,
    dto: CreateVisitDto,
    outer?: Prisma.TransactionClient,
  ): Promise<VisitCreated> {
    const db = outer ?? this.prisma;
    const existing = await db.visit.findUnique({ where: { clientId: dto.clientId } });
    if (existing) {
      // A retry after the idempotency record expired, or under another key.
      if (existing.volunteerId !== actor.userId || existing.householdId !== dto.householdId) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'clientId is already used by another visit',
        );
      }
      return { ...summary(existing), duplicate: true, consents: [], fieldChanges: [] };
    }

    const household = foundInScope(
      await db.household.findFirst({
        where: { id: dto.householdId, ...inScope(scope) },
        select: { id: true, pollingStationId: true, voters: { select: { id: true } } },
      }),
      'Household',
    );
    const members = new Set(household.voters.map((voter) => voter.id));

    const startedAt = new Date(dto.startedAt);
    const completedAt = dto.completedAt ? new Date(dto.completedAt) : null;
    const latest = Date.now() + CLOCK_SKEW_MS;
    if (startedAt.getTime() > latest || (completedAt && completedAt.getTime() > latest)) {
      throw unprocessable('Visit times cannot be in the future');
    }
    if (completedAt && completedAt < startedAt) {
      throw unprocessable('completedAt is before startedAt');
    }
    for (const voterId of dto.memberIdsMet ?? []) {
      if (!members.has(voterId)) {
        throw unprocessable('memberIdsMet has someone outside the household');
      }
    }
    const consents = dto.consents ?? [];
    if (new Set(consents.map((c) => c.ref)).size !== consents.length) {
      throw unprocessable('consent refs must be unique');
    }
    for (const consent of consents) {
      if (consent.voterId && !members.has(consent.voterId)) {
        throw unprocessable('A consent names someone outside the household');
      }
    }
    for (const change of dto.fieldChanges ?? []) {
      if (change.consentRef && !consents.some((c) => c.ref === change.consentRef)) {
        throw unprocessable(`No consent with ref "${change.consentRef}" in this visit`);
      }
    }
    if (dto.correctsVisitId) await this.checkCorrection(db, scope, actor, dto);

    const write = async (tx: Prisma.TransactionClient): Promise<VisitCreated> => {
      const visit = await tx.visit.create({
        data: {
          clientId: dto.clientId,
          householdId: household.id,
          volunteerId: actor.userId,
          startedAt,
          completedAt,
          outcome: dto.outcome,
          formVersion: dto.formVersion,
          notes: dto.notes ?? null,
          correctsVisitId: dto.correctsVisitId ?? null,
          membersMet: { create: (dto.memberIdsMet ?? []).map((voterId) => ({ voterId })) },
        },
      });

      const created: { ref: string; id: string }[] = [];
      for (const consent of consents) {
        const row = await tx.consent.create({
          data: {
            subjectVoterId: consent.voterId ?? null,
            subjectHouseholdId: consent.voterId ? null : household.id,
            purpose: consent.purpose,
            noticeVersion: consent.noticeVersion,
            capturedMethod: consent.method,
            capturedById: actor.userId,
            capturedAt: startedAt,
          },
        });
        created.push({ ref: consent.ref, id: row.id });
      }
      const consentIdOf = (ref: string) => created.find((c) => c.ref === ref)?.id;

      // Only this household and its members may be changed from its visit.
      const changes = dto.fieldChanges ?? [];
      const results: (FieldChangeResult | undefined)[] = changes.map((change) =>
        (
          change.entityType === 'household'
            ? change.entityId === household.id
            : members.has(change.entityId)
        )
          ? undefined
          : {
              status: 'rejected',
              code: ErrorCode.NOT_FOUND,
              message: `${change.entityType} is not part of this household`,
            },
      );
      const toWrite = changes.flatMap((change, index): (FieldChange & { index: number })[] =>
        results[index]
          ? []
          : [
              {
                index,
                entityType: change.entityType,
                entityId: change.entityId,
                fieldKey: change.fieldKey,
                value: change.value as Prisma.InputJsonValue,
                baseVersion: change.baseVersion,
                consentId: change.consentRef ? consentIdOf(change.consentRef) : change.consentId,
                collectedAt: change.collectedAt ? new Date(change.collectedAt) : startedAt,
              },
            ],
      );
      const written = await this.fieldValues.write(scope, actor.userId, toWrite, tx);
      toWrite.forEach((change, i) => (results[change.index] = written[i]));
      const fieldChanges = results as FieldChangeResult[];

      // Field-work analytics for the station, refreshed after this commits.
      await this.stats.request([household.pollingStationId], tx);
      await this.audit.record(
        {
          action: 'visit.create',
          resourceType: 'visit',
          resourceId: visit.id,
          result: 'success',
          actorId: actor.userId,
          sessionId: actor.sessionId ?? null,
          requestId: actor.requestId ?? null,
          metadata: {
            householdId: household.id,
            outcome: visit.outcome,
            correctsVisitId: visit.correctsVisitId,
            consents: created.length,
            applied: fieldChanges.filter((r) => r.status === 'applied').length,
            conflicts: fieldChanges.filter((r) => r.status === 'conflict').length,
            rejected: fieldChanges.filter((r) => r.status === 'rejected').length,
          },
        },
        tx,
      );

      return { ...summary(visit), duplicate: false, consents: created, fieldChanges };
    };
    return outer ? write(outer) : this.prisma.$transaction(write);
  }

  /**
   * A correction ("edit from list") replaces an earlier visit to the same
   * household: the volunteer who recorded it, or an admin, may correct it,
   * once. A correction can itself be corrected.
   */
  private async checkCorrection(
    db: Prisma.TransactionClient,
    scope: Scope,
    actor: Actor,
    dto: CreateVisitDto,
  ): Promise<void> {
    const original = await db.visit.findFirst({
      where: { id: dto.correctsVisitId, householdId: dto.householdId },
      select: { volunteerId: true, correctedBy: { select: { id: true } } },
    });
    if (!original) throw unprocessable('correctsVisitId is not a visit to this household');
    if (original.volunteerId !== actor.userId && !scope.roles.includes('admin')) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only the volunteer who recorded a visit, or an admin, can correct it',
      );
    }
    if (original.correctedBy) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'This visit has already been corrected; correct the latest version',
      );
    }
  }
}

function summary(visit: {
  id: string;
  clientId: string;
  householdId: string;
  outcome: VisitOutcome;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  correctsVisitId: string | null;
}) {
  return {
    id: visit.id,
    clientId: visit.clientId,
    householdId: visit.householdId,
    outcome: visit.outcome,
    startedAt: visit.startedAt,
    completedAt: visit.completedAt,
    createdAt: visit.createdAt,
    correctsVisitId: visit.correctsVisitId,
  };
}
