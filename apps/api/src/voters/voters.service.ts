import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  ConsentsService,
  type StaffConsent,
  type StaffConsents,
} from '../consents/consents.service';

import type { Scope } from '../authz/scope.service';
import type { Actor } from '../common/actor';
import { seesRestricted } from '../authz/restricted-fields';
import { foundInScope, inScope } from '../authz/scoped-query';
import { PrismaService } from '../database/prisma.service';
import { voterLineage } from '../field-values/field-values.service';
import type {
  FieldType,
  Prisma,
  RecordOrigin,
  ValueSource,
  VisitOutcome,
  VoterRecordStatus,
} from '../generated/prisma/client';

export interface FieldValueView {
  /** Send this as `base_version` when editing the field. */
  id: string;
  value: Prisma.JsonValue;
  sourceType: ValueSource;
  collectedBy: { id: string; name: string } | null;
  collectedAt: Date;
  /** The value this one replaced. */
  supersedesId: string | null;
  /** Copied from this value on the voter's previous record, when a newer roll replaced it (#161). */
  carriedFromId: string | null;
  /** Set while this value conflicts with another current value. */
  conflictWithId: string | null;
}

export interface VoterField {
  key: string;
  labelKey: string;
  type: FieldType;
  options: Prisma.JsonValue;
  isRestricted: boolean;
  requiresConsent: boolean;
  /** Usually one; two while an offline conflict waits for a choice. Empty: never set. */
  current: FieldValueView[];
  /** With `?history=true`: every earlier value, newest first. */
  history?: FieldValueView[];
}

export interface VoterDetail {
  id: string;
  householdId: string;
  partId: string;
  pollingStationId: string;
  origin: RecordOrigin;
  recordStatus: VoterRecordStatus;
  sectionNo: number | null;
  serialNo: number | null;
  epicNumber: string | null;
  /** The roll's values as printed; never changed by edits. Null for added members. */
  official: Prisma.JsonValue;
  /** The voter's earlier records, newest first, that newer rolls replaced (#161). */
  previousVoterIds: string[];
  /** Every enabled field the caller may see, set or not. */
  fields: VoterField[];
  /** Visits that met this voter, on this record or an earlier one; newest first. */
  visitsMet: VoterVisit[];
}

export interface VoterVisit {
  id: string;
  householdId: string;
  volunteer: { id: string; name: string };
  startedAt: Date;
  outcome: VisitOutcome;
  /** The later visit that corrects this one, if any. */
  correctedById: string | null;
}

@Injectable()
export class VotersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly consentsService: ConsentsService,
  ) {}

  /**
   * The voter's consents (#213), newest first, with who recorded and who
   * withdrew each. A voter outside the caller's booths is 404.
   */
  async consents(scope: Scope, id: string): Promise<StaffConsents> {
    const voter = foundInScope(
      await this.prisma.voter.findFirst({ where: { id, ...inScope(scope) } }),
      'Voter',
    );
    return { items: await this.consentsService.list(voter.id) };
  }

  /**
   * Withdraws one of the voter's consents at their request, recorded by
   * their volunteer or an admin (#213): the covered values stop being shown
   * and synced at once. Audited as `consent.withdraw`, by the caller's role.
   */
  async withdrawConsent(
    scope: Scope,
    actor: Actor,
    id: string,
    consentId: string,
  ): Promise<StaffConsent> {
    const voter = foundInScope(
      await this.prisma.voter.findFirst({ where: { id, ...inScope(scope) } }),
      'Voter',
    );
    const by = scope.roles.includes('admin') ? 'admin' : 'volunteer';
    return this.consentsService.withdraw(voter.id, consentId, actor, by);
  }

  /**
   * One voter's record. Opening it is audited (`voter.view`, ids only), as
   * is every change to it.
   */
  async get(scope: Scope, actor: Actor, id: string, withHistory = false): Promise<VoterDetail> {
    const voter = foundInScope(
      await this.prisma.voter.findFirst({ where: { id, ...inScope(scope) } }),
      'Voter',
    );
    await this.audit.record({
      action: 'voter.view',
      resourceType: 'voter',
      resourceId: voter.id,
      result: 'success',
      actorId: actor.userId,
      sessionId: actor.sessionId ?? null,
      requestId: actor.requestId ?? null,
      metadata: { history: withHistory },
    });
    const restricted = seesRestricted(scope);

    const definitions = await this.prisma.fieldDefinition.findMany({
      where: {
        programId: voter.programId,
        appliesTo: 'voter',
        enabled: true,
        ...(restricted ? {} : { isRestricted: false }),
      },
      // In the order they were defined; seeded ones (same instant) by key.
      orderBy: [{ createdAt: 'asc' }, { key: 'asc' }],
    });
    const values = await this.prisma.fieldValue.findMany({
      where: {
        entityType: 'voter',
        entityId: voter.id,
        fieldDefinitionId: { in: definitions.map((d) => d.id) },
        ...(withHistory ? {} : { isCurrent: true }),
      },
      include: {
        collectedBy: { select: { id: true, name: true } },
        consent: { select: { status: true } },
      },
      orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
    });

    const lineage = await voterLineage(this.prisma, voter.id);
    const visits = await this.prisma.visit.findMany({
      // Only visits to households the caller can see (a voter may have moved house).
      where: { membersMet: { some: { voterId: { in: lineage } } }, household: inScope(scope) },
      include: {
        volunteer: { select: { id: true, name: true } },
        correctedBy: { select: { id: true } },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    });

    return {
      id: voter.id,
      householdId: voter.householdId,
      partId: voter.partId,
      pollingStationId: voter.pollingStationId,
      origin: voter.origin,
      recordStatus: voter.recordStatus,
      sectionNo: voter.sectionNo,
      serialNo: voter.serialNo,
      epicNumber: voter.sourceVoterId,
      official: voter.sourceData,
      previousVoterIds: lineage.slice(1),
      visitsMet: visits.map((visit) => ({
        id: visit.id,
        householdId: visit.householdId,
        volunteer: visit.volunteer,
        startedAt: visit.startedAt,
        outcome: visit.outcome,
        correctedById: visit.correctedBy?.id ?? null,
      })),
      fields: definitions.map((definition) => {
        const own = values.filter(
          (row) =>
            row.fieldDefinitionId === definition.id &&
            // A consent-gated value is shown only while its consent stands.
            (!definition.requiresConsent || row.consent?.status === 'granted'),
        );
        const view = (row: (typeof own)[number]): FieldValueView => ({
          id: row.id,
          value: row.value,
          sourceType: row.sourceType,
          collectedBy: row.collectedBy,
          collectedAt: row.collectedAt,
          supersedesId: row.supersedesId,
          carriedFromId: row.carriedFromId,
          conflictWithId: row.conflictWithId,
        });
        return {
          key: definition.key,
          labelKey: definition.labelKey,
          type: definition.type,
          options: definition.options,
          isRestricted: definition.isRestricted,
          requiresConsent: definition.requiresConsent,
          current: own.filter((row) => row.isCurrent).map(view),
          ...(withHistory ? { history: own.filter((row) => !row.isCurrent).map(view) } : {}),
        };
      }),
    };
  }
}
