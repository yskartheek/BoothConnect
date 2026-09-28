import { Injectable } from '@nestjs/common';

import type { Scope } from '../authz/scope.service';
import { inScope } from '../authz/scoped-query';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../database/prisma.service';
import type { FieldEntity, FieldType, Prisma, ValueSource } from '../generated/prisma/client';
import { type Address, displayAddress, isValidValue, type Location } from './field-value-rules';

type Tx = Prisma.TransactionClient;

/** One change to one field of one voter or household. */
export interface FieldChange {
  entityType: FieldEntity;
  entityId: string;
  /** The field definition's key, e.g. "mobile_number". */
  fieldKey: string;
  value: Prisma.InputJsonValue;
  /**
   * The `field_value` ID the client last saw for this field, or null if it saw
   * none. Anything but the current value makes the change a conflict.
   */
  baseVersion: string | null;
  /** Required for consent-gated fields: a granted consent for this entity and field. */
  consentId?: string;
  /** When it was collected on the phone (it may have been offline); default now. */
  collectedAt?: Date;
  sourceType?: ValueSource;
}

export type RejectionCode =
  | typeof ErrorCode.NOT_FOUND
  | typeof ErrorCode.FIELD_UNKNOWN
  | typeof ErrorCode.FIELD_DISABLED
  | typeof ErrorCode.CONSENT_REQUIRED
  | typeof ErrorCode.INVALID_VALUE
  | typeof ErrorCode.BASE_VERSION_INVALID;

export type FieldChangeResult =
  /** Stored as the current value, superseding `supersedesId` (if any). */
  | { status: 'applied'; fieldValueId: string; supersedesId: string | null }
  /** Stored, but the field had moved on: both values are current until the volunteer chooses. */
  | { status: 'conflict'; fieldValueId: string; conflictWithId: string }
  /** Nothing stored. */
  | { status: 'rejected'; code: RejectionCode; message: string };

const rejected = (code: RejectionCode, message: string): FieldChangeResult => ({
  status: 'rejected',
  code,
  message,
});

/**
 * The one place field values are written (visits, sync push, member and
 * household edits). Values are append-only: an edit inserts a new current
 * value that supersedes the old one, and official `source_data` is never
 * touched (ADR 0003).
 */
@Injectable()
export class FieldValuesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Applies each change and reports its own result; a rejected or conflicting
   * change doesn't stop the others. Pass `tx` to write inside the caller's
   * transaction (e.g. together with a visit); otherwise each change commits
   * on its own.
   */
  async write(
    scope: Scope,
    collectedById: string,
    changes: FieldChange[],
    tx?: Tx,
  ): Promise<FieldChangeResult[]> {
    const results: FieldChangeResult[] = [];
    for (const change of changes) {
      results.push(
        tx
          ? await this.writeOne(tx, scope, collectedById, change)
          : await this.prisma.$transaction((own) =>
              this.writeOne(own, scope, collectedById, change),
            ),
      );
    }
    return results;
  }

  private async writeOne(
    tx: Tx,
    scope: Scope,
    collectedById: string,
    change: FieldChange,
  ): Promise<FieldChangeResult> {
    const entity = await this.findInScope(tx, scope, change.entityType, change.entityId);
    if (!entity) return rejected(ErrorCode.NOT_FOUND, `${change.entityType} not found`);

    const definition = await tx.fieldDefinition.findUnique({
      where: { programId_key: { programId: entity.programId, key: change.fieldKey } },
    });
    if (!definition || definition.appliesTo !== change.entityType) {
      return rejected(
        ErrorCode.FIELD_UNKNOWN,
        `No ${change.entityType} field "${change.fieldKey}"`,
      );
    }
    if (!definition.enabled) {
      return rejected(ErrorCode.FIELD_DISABLED, `Field "${definition.key}" is not collected`);
    }
    if (!isValidValue(definition.type, definition.options, change.value)) {
      return rejected(
        ErrorCode.INVALID_VALUE,
        `Not a valid ${definition.type} for "${definition.key}"`,
      );
    }
    if (definition.requiresConsent) {
      const consent = change.consentId
        ? await tx.consent.findUnique({ where: { id: change.consentId } })
        : null;
      const subject =
        change.entityType === 'voter' ? consent?.subjectVoterId : consent?.subjectHouseholdId;
      if (
        !consent ||
        consent.status !== 'granted' ||
        consent.purpose !== definition.key ||
        subject !== change.entityId
      ) {
        return rejected(
          ErrorCode.CONSENT_REQUIRED,
          `Field "${definition.key}" needs the person's recorded consent`,
        );
      }
    }

    // Serialise writers of this entity's field until the transaction ends, so
    // two edits can't both supersede the same value.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`field_value:${change.entityId}:${definition.id}`}, 0))`;

    if (change.baseVersion) {
      const base = await tx.fieldValue.findUnique({ where: { id: change.baseVersion } });
      if (
        !base ||
        base.entityType !== change.entityType ||
        base.entityId !== change.entityId ||
        base.fieldDefinitionId !== definition.id
      ) {
        return rejected(
          ErrorCode.BASE_VERSION_INVALID,
          'base_version is not a value of this field',
        );
      }
    }

    const current = await tx.fieldValue.findMany({
      where: {
        entityType: change.entityType,
        entityId: change.entityId,
        fieldDefinitionId: definition.id,
        isCurrent: true,
      },
      orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const clean =
      current.length === 0
        ? change.baseVersion === null
        : current.length === 1 && current[0]?.id === change.baseVersion;

    const data = {
      entityType: change.entityType,
      entityId: change.entityId,
      fieldDefinitionId: definition.id,
      value: change.value,
      sourceType: change.sourceType ?? 'volunteer_collected',
      consentId: change.consentId ?? null,
      collectedById,
      collectedAt: change.collectedAt ?? new Date(),
      baseVersion: change.baseVersion,
    } satisfies Prisma.FieldValueUncheckedCreateInput;

    if (clean) {
      const supersedesId = current[0]?.id ?? null;
      const row = await tx.fieldValue.create({ data: { ...data, supersedesId } });
      await projectOntoHousehold(tx, change.entityType, change.entityId, definition.type, {
        value: change.value,
        consentId: data.consentId,
      });
      return { status: 'applied', fieldValueId: row.id, supersedesId };
    }
    // Stale base (or an unresolved conflict): keep both; the newest current
    // value is the one it conflicts with.
    const conflictWithId = current[0]!.id;
    const row = await tx.fieldValue.create({ data: { ...data, conflictWithId } });
    return { status: 'conflict', fieldValueId: row.id, conflictWithId };
  }

  private async findInScope(
    tx: Tx,
    scope: Scope,
    entityType: FieldEntity,
    id: string,
  ): Promise<{ programId: string } | null> {
    if (entityType === 'voter') {
      return tx.voter.findFirst({ where: { id, ...inScope(scope) }, select: { programId: true } });
    }
    const household = await tx.household.findFirst({
      where: { id, ...inScope(scope) },
      select: { part: { select: { programId: true } } },
    });
    return household && { programId: household.part.programId };
  }
}

/**
 * The household row keeps a copy of its current address and location, for
 * lists, search and maps. Called whenever such a value becomes current (an
 * applied edit, or the value kept when a conflict is resolved).
 */
export async function projectOntoHousehold(
  tx: Tx,
  entityType: FieldEntity,
  householdId: string,
  type: FieldType,
  current: { value: unknown; consentId: string | null },
): Promise<void> {
  if (entityType !== 'household') return;
  if (type === 'address') {
    const address = current.value as Address;
    const household = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { origin: true },
    });
    await tx.household.update({
      where: { id: householdId },
      data: {
        structuredAddress: address,
        displayAddress: displayAddress(address),
        // A roll household keeps the roll's house number for grouping.
        ...(household.origin === 'volunteer_added' && address.house_no
          ? { houseKey: address.house_no.trim() }
          : {}),
      },
    });
  }
  if (type === 'location') {
    const location = current.value as Location;
    await tx.household.update({
      where: { id: householdId },
      data: {
        locationLat: location.lat,
        locationLng: location.lng,
        locationAccuracyM: location.accuracyM ?? null,
        locationCapturedAt: new Date(location.capturedAt),
        locationConsentId: current.consentId,
      },
    });
  }
}
