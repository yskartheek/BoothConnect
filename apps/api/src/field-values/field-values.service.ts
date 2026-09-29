import { Injectable } from '@nestjs/common';

import { seesRestricted } from '../authz/restricted-fields';
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
  /**
   * Stored as the current value, superseding `supersedesId` (if any).
   * `entityId` is where it was stored: a change for a voter record that a
   * newer roll replaced goes to the current record (#161).
   */
  | { status: 'applied'; entityId: string; fieldValueId: string; supersedesId: string | null }
  /** Stored, but the field had moved on: both values are current until the volunteer chooses. */
  | { status: 'conflict'; entityId: string; fieldValueId: string; conflictWithId: string }
  /** Nothing stored. */
  | { status: 'rejected'; code: RejectionCode; message: string };

export type ConflictResolution =
  /** `keptId` is the current value; `discardedIds` stay in history. */
  | {
      status: 'resolved';
      keptId: string;
      discardedIds: string[];
      entityType: FieldEntity;
      entityId: string;
      fieldKey: string;
    }
  /** Nothing was open and `keptId` is already the current value: nothing changed. */
  | { status: 'already_resolved'; keptId: string }
  | {
      status: 'rejected';
      code: typeof ErrorCode.NOT_FOUND | typeof ErrorCode.CONFLICT;
      message: string;
    };

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
    requested: FieldChange,
  ): Promise<FieldChangeResult> {
    // A phone that was offline when a newer roll replaced the voter's record
    // still sends the old IDs: write to the current record, and read the
    // base version through the values carried over to it (#161).
    const change = await this.onCurrentRecord(tx, requested);
    const entity = await this.findInScope(tx, scope, change.entityType, change.entityId);
    if (!entity) return rejected(ErrorCode.NOT_FOUND, `${change.entityType} not found`);

    const definition = await tx.fieldDefinition.findUnique({
      where: { programId_key: { programId: entity.programId, key: change.fieldKey } },
    });
    // A restricted field is invisible to roles that may not see it, so it is
    // "unknown" to them rather than forbidden.
    if (
      !definition ||
      definition.appliesTo !== change.entityType ||
      (definition.isRestricted && !seesRestricted(scope))
    ) {
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
      // A voter's consent may have been given on one of their earlier records.
      const subjects =
        change.entityType === 'voter' ? await voterLineage(tx, change.entityId) : [change.entityId];
      const subject =
        change.entityType === 'voter' ? consent?.subjectVoterId : consent?.subjectHouseholdId;
      if (
        !consent ||
        consent.status !== 'granted' ||
        consent.purpose !== definition.key ||
        !subject ||
        !subjects.includes(subject)
      ) {
        return rejected(
          ErrorCode.CONSENT_REQUIRED,
          `Field "${definition.key}" needs the person's recorded consent`,
        );
      }
    }

    await lockField(tx, change.entityId, definition.id);

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
        ? change.baseVersion === null || change.staleBase
        : !change.staleBase && current.length === 1 && current[0]?.id === change.baseVersion;

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
      return { status: 'applied', entityId: change.entityId, fieldValueId: row.id, supersedesId };
    }
    // Stale base (or an unresolved conflict): keep both; the newest current
    // value is the one it conflicts with.
    const conflictWithId = current[0]!.id;
    const row = await tx.fieldValue.create({ data: { ...data, conflictWithId } });
    return { status: 'conflict', entityId: change.entityId, fieldValueId: row.id, conflictWithId };
  }

  /**
   * The change, aimed at the voter's current record when a newer roll
   * replaced the one it names. Its base version becomes the copy carried over
   * from it; a base that wasn't carried (it was no longer current) is stale.
   */
  private async onCurrentRecord(
    tx: Tx,
    change: FieldChange,
  ): Promise<FieldChange & { staleBase: boolean }> {
    if (change.entityType !== 'voter') return { ...change, staleBase: false };
    const entityId = await currentRecord(tx, change.entityId);
    if (entityId === change.entityId) return { ...change, staleBase: false };
    if (!change.baseVersion) return { ...change, entityId, staleBase: false };
    const copy = await carriedCopy(tx, change.baseVersion, entityId);
    if (copy) return { ...change, entityId, baseVersion: copy, staleBase: false };
    // A value of the old record that wasn't current any more: stale, so a
    // conflict. Anything else is not a value of this field: rejected below.
    const base = await tx.fieldValue.findUnique({ where: { id: change.baseVersion } });
    return base?.entityType === 'voter' && base.entityId === change.entityId
      ? { ...change, entityId, baseVersion: null, staleBase: true }
      : { ...change, entityId, staleBase: false };
  }

  /**
   * Resolves an open conflict on the field that value `conflictId` belongs
   * to: `keepId` (one of the field's current values) stays current, every
   * other current value leaves (it stays in history), and the conflict marks
   * are cleared. Resolving again, keeping the same value, changes nothing.
   */
  async resolveConflict(
    scope: Scope,
    conflictId: string,
    keepId: string,
    tx: Tx,
  ): Promise<ConflictResolution> {
    // Values of a voter record that a newer roll replaced: their copies on
    // the current record, where the conflict was carried over (#161).
    const original = await tx.fieldValue.findUnique({ where: { id: conflictId } });
    if (original?.entityType === 'voter') {
      const current = await currentRecord(tx, original.entityId);
      if (current !== original.entityId) {
        const [conflictCopy, keepCopy] = await Promise.all([
          carriedCopy(tx, conflictId, current),
          carriedCopy(tx, keepId, current),
        ]);
        if (!conflictCopy || !keepCopy) {
          return {
            status: 'rejected',
            code: ErrorCode.CONFLICT,
            message: 'There is no open conflict on this field to keep that value for',
          };
        }
        conflictId = conflictCopy;
        keepId = keepCopy;
      }
    }
    const value = await tx.fieldValue.findUnique({
      where: { id: conflictId },
      include: { fieldDefinition: true },
    });
    const definition = value?.fieldDefinition;
    // Outside the scope, or a field the caller may not see: as if missing.
    if (
      !value ||
      !definition ||
      !(await this.findInScope(tx, scope, value.entityType, value.entityId)) ||
      (definition.isRestricted && !seesRestricted(scope))
    ) {
      return { status: 'rejected', code: ErrorCode.NOT_FOUND, message: 'Conflict not found' };
    }
    await lockField(tx, value.entityId, definition.id);

    const current = await tx.fieldValue.findMany({
      where: {
        entityType: value.entityType,
        entityId: value.entityId,
        fieldDefinitionId: definition.id,
        isCurrent: true,
      },
    });
    const keep = current.find((row) => row.id === keepId);
    const open = current.length > 1 || current.some((row) => row.conflictWithId !== null);
    if (!open) {
      return keep
        ? { status: 'already_resolved', keptId: keep.id }
        : {
            status: 'rejected',
            code: ErrorCode.CONFLICT,
            message: 'There is no open conflict on this field to keep that value for',
          };
    }
    if (!keep) {
      return {
        status: 'rejected',
        code: ErrorCode.CONFLICT,
        message: 'keepFieldValueId must be one of the conflicting values',
      };
    }

    const discardedIds = current.filter((row) => row.id !== keep.id).map((row) => row.id);
    await tx.fieldValue.updateMany({
      where: { id: { in: discardedIds } },
      data: { isCurrent: false, conflictWithId: null },
    });
    await tx.fieldValue.update({ where: { id: keep.id }, data: { conflictWithId: null } });
    await projectOntoHousehold(tx, value.entityType, value.entityId, definition.type, {
      value: keep.value,
      consentId: keep.consentId,
    });
    return {
      status: 'resolved',
      keptId: keep.id,
      discardedIds,
      entityType: value.entityType,
      entityId: value.entityId,
      fieldKey: definition.key,
    };
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

/** A voter's records, newest first: the record itself, then each one it replaced (#161). */
export async function voterLineage(tx: Tx | PrismaService, voterId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM voter_lineage(${voterId}::uuid) ORDER BY depth`;
  return rows.map((r) => r.id);
}

/** The voter's current record: this one, or the newest record that replaced it. */
async function currentRecord(tx: Tx, voterId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT ${voterId}::uuid, 0
      UNION ALL
      SELECT v.id, c.depth + 1 FROM chain c JOIN voter v ON v.previous_voter_id = c.id
       WHERE c.depth < 100
    )
    SELECT id FROM chain ORDER BY depth DESC LIMIT 1`;
  return rows[0]?.id ?? voterId;
}

/** The copy of a value carried over (possibly several times) to `entityId`, if any. */
async function carriedCopy(tx: Tx, valueId: string, entityId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE chain(id, entity_id, depth) AS (
      SELECT id, entity_id, 0 FROM field_value WHERE id = ${valueId}::uuid
      UNION ALL
      SELECT f.id, f.entity_id, c.depth + 1 FROM chain c JOIN field_value f ON f.carried_from_id = c.id
       WHERE c.depth < 100
    )
    SELECT id FROM chain WHERE entity_id = ${entityId}::uuid LIMIT 1`;
  return rows[0]?.id ?? null;
}

/**
 * Serialises writers of one entity's field until the transaction ends, so two
 * edits (or an edit and a conflict resolution) can't interleave.
 */
async function lockField(tx: Tx, entityId: string, fieldDefinitionId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`field_value:${entityId}:${fieldDefinitionId}`}, 0))`;
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
