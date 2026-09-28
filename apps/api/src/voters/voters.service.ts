import { Injectable } from '@nestjs/common';

import type { Scope } from '../authz/scope.service';
import { foundInScope, inScope } from '../authz/scoped-query';
import { PrismaService } from '../database/prisma.service';
import type {
  FieldType,
  Prisma,
  RecordOrigin,
  Role,
  ValueSource,
  VoterRecordStatus,
} from '../generated/prisma/client';

/**
 * Roles that may see restricted fields (caste/community): the volunteers who
 * collect them with the voter's consent, and admins who correct them
 * (ADR 0003). Campaign managers see restricted data only as thresholded
 * aggregates in analytics.
 */
export const RESTRICTED_FIELD_ROLES: readonly Role[] = ['admin', 'volunteer'];

export interface FieldValueView {
  /** Send this as `base_version` when editing the field. */
  id: string;
  value: Prisma.JsonValue;
  sourceType: ValueSource;
  collectedBy: { id: string; name: string } | null;
  collectedAt: Date;
  /** The value this one replaced. */
  supersedesId: string | null;
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
  /** Every enabled field the caller may see, set or not. */
  fields: VoterField[];
}

@Injectable()
export class VotersService {
  constructor(private readonly prisma: PrismaService) {}

  async get(scope: Scope, id: string, withHistory = false): Promise<VoterDetail> {
    const voter = foundInScope(
      await this.prisma.voter.findFirst({ where: { id, ...inScope(scope) } }),
      'Voter',
    );
    const seesRestricted = scope.roles.some((role) => RESTRICTED_FIELD_ROLES.includes(role));

    const definitions = await this.prisma.fieldDefinition.findMany({
      where: {
        programId: voter.programId,
        appliesTo: 'voter',
        enabled: true,
        ...(seesRestricted ? {} : { isRestricted: false }),
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
