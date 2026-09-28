import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { foundInScope, inScope, notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../database/prisma.service';
import { displayAddress } from '../field-values/field-value-rules';
import {
  type FieldChange,
  type FieldChangeResult,
  FieldValuesService,
} from '../field-values/field-values.service';
import type { Prisma } from '../generated/prisma/client';
import type {
  AddMemberDto,
  AddressDto,
  CreateHouseholdDto,
  LocationDto,
  UpdateHouseholdDto,
} from './dto';
import { type HouseholdDetail, HouseholdsService } from './households.service';

type Tx = Prisma.TransactionClient;

/** Field keys of the household fields (seeded per program). */
export const ADDRESS_FIELD = 'address';
export const LOCATION_FIELD = 'household_location';

export interface HouseholdCreated extends HouseholdDetail {
  /** True when a household with this client-generated `id` already existed. */
  duplicate: boolean;
}

export interface HouseholdUpdated {
  household: HouseholdDetail;
  /** One result per field sent. */
  results: { address?: FieldChangeResult; location?: FieldChangeResult };
}

export interface MemberCreated {
  id: string;
  householdId: string;
  duplicate: boolean;
  /** name, age, gender, then `fields`, in that order. */
  fields: (FieldChangeResult & { fieldKey: string })[];
}

const unprocessable = (message: string, details?: unknown) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, message, details);

/**
 * Volunteer-added households and members, and address and location edits
 * (spec v1.1, ADR 0003). Every value goes through the field-value service,
 * so it gets base_version conflict checks and history; each call is one
 * transaction with its audit event.
 */
@Injectable()
export class HouseholdWritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldValues: FieldValuesService,
    private readonly households: HouseholdsService,
    private readonly audit: AuditService,
  ) {}

  async create(
    scope: Scope,
    actor: Actor,
    dto: CreateHouseholdDto,
    outer?: Tx,
  ): Promise<HouseholdCreated> {
    const db = outer ?? this.prisma;
    if (dto.id) {
      const existing = await db.household.findUnique({ where: { id: dto.id } });
      if (existing) {
        return {
          ...(await this.existing(db, scope, existing, dto.pollingStationId)),
          duplicate: true,
        };
      }
    }
    if (!scope.boothIds.includes(dto.pollingStationId)) throw notFound('Polling station');
    const station = await db.geographyNode.findUniqueOrThrow({
      where: { id: dto.pollingStationId },
      select: { parentId: true },
    });
    const address = cleanAddress(dto.address);

    const newId = dto.id ?? randomUUID();

    const write = async (tx: Tx): Promise<HouseholdCreated> => {
      const household = await tx.household.create({
        data: {
          id: newId,
          partId: station.parentId!,
          pollingStationId: dto.pollingStationId,
          // Unique per part: a house number already in the part is a 409
          // (the house is probably there already). Without one, a key that
          // can't clash.
          houseKey: address.house_no ?? `~${newId}`,
          displayAddress: displayAddress(address),
          structuredAddress: { ...address },
          origin: 'volunteer_added',
        },
      });
      const results = await this.writeAddressAndLocation(tx, scope, actor, household.id, {
        address,
        addressBaseVersion: null,
        location: dto.location,
        locationBaseVersion: null,
      });
      for (const [field, result] of Object.entries(results)) {
        if (result?.status !== 'applied') {
          throw unprocessable(`The household's ${field} could not be saved`, result);
        }
      }
      await this.audit.record(
        {
          ...auditBase(actor),
          action: 'household.create',
          resourceType: 'household',
          resourceId: household.id,
          metadata: { pollingStationId: dto.pollingStationId, withLocation: !!dto.location },
        },
        tx,
      );
      return { ...(await this.households.get(scope, household.id, tx)), duplicate: false };
    };
    return outer ? write(outer) : this.prisma.$transaction(write);
  }

  async update(
    scope: Scope,
    actor: Actor,
    id: string,
    dto: UpdateHouseholdDto,
    outer?: Tx,
  ): Promise<HouseholdUpdated> {
    const db = outer ?? this.prisma;
    if (!dto.address && !dto.location) throw unprocessable('Send an address, a location or both');
    if (
      (dto.address && dto.addressBaseVersion === undefined) ||
      (dto.location && dto.locationBaseVersion === undefined)
    ) {
      throw unprocessable('Each field sent needs its base version (null if the phone had none)');
    }
    foundInScope(
      await db.household.findFirst({
        where: { id, ...inScope(scope) },
        select: { id: true },
      }),
      'Household',
    );

    const write = async (tx: Tx): Promise<HouseholdUpdated> => {
      const written = await this.writeAddressAndLocation(tx, scope, actor, id, {
        address: dto.address && cleanAddress(dto.address),
        addressBaseVersion: dto.addressBaseVersion ?? null,
        location: dto.location,
        locationBaseVersion: dto.locationBaseVersion ?? null,
      });
      await this.audit.record(
        {
          ...auditBase(actor),
          action: 'household.update',
          resourceType: 'household',
          resourceId: id,
          metadata: {
            address: written.address?.status ?? null,
            location: written.location?.status ?? null,
          },
        },
        tx,
      );
      return { household: await this.households.get(scope, id, tx), results: written };
    };
    return outer ? write(outer) : this.prisma.$transaction(write);
  }

  async addMember(
    scope: Scope,
    actor: Actor,
    householdId: string,
    dto: AddMemberDto,
    outer?: Tx,
  ): Promise<MemberCreated> {
    const db = outer ?? this.prisma;
    const household = foundInScope(
      await db.household.findFirst({
        where: { id: householdId, ...inScope(scope) },
        select: {
          id: true,
          partId: true,
          pollingStationId: true,
          part: { select: { programId: true } },
        },
      }),
      'Household',
    );
    if (dto.id) {
      const existing = await db.voter.findUnique({ where: { id: dto.id } });
      if (existing) {
        if (existing.householdId !== household.id || existing.origin !== 'volunteer_added') {
          throw new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'id is already used');
        }
        return { id: existing.id, householdId, duplicate: true, fields: [] };
      }
    }

    const changes: { fieldKey: string; value: unknown; consentId?: string }[] = [
      { fieldKey: 'name', value: dto.name.trim() },
      ...(dto.age === undefined ? [] : [{ fieldKey: 'age', value: dto.age }]),
      ...(dto.gender === undefined ? [] : [{ fieldKey: 'gender', value: dto.gender }]),
      ...(dto.fields ?? []),
    ];
    const keys = changes.map((c) => c.fieldKey);
    if (new Set(keys).size !== keys.length) throw unprocessable('Each field can be sent once');

    const write = async (tx: Tx): Promise<MemberCreated> => {
      const voter = await tx.voter.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          programId: household.part.programId,
          householdId: household.id,
          partId: household.partId,
          pollingStationId: household.pollingStationId,
          origin: 'volunteer_added',
        },
      });
      const results = await this.fieldValues.write(
        scope,
        actor.userId,
        changes.map((c): FieldChange => ({
          entityType: 'voter',
          entityId: voter.id,
          fieldKey: c.fieldKey,
          value: c.value as Prisma.InputJsonValue,
          baseVersion: null,
          consentId: c.consentId,
        })),
        tx,
      );
      const fields = results.map((result, i) => ({ fieldKey: keys[i]!, ...result }));
      // A member must at least have a name; the other fields report their own result.
      if (fields[0]?.status !== 'applied')
        throw unprocessable('The name could not be saved', fields[0]);
      await this.audit.record(
        {
          ...auditBase(actor),
          action: 'member.create',
          resourceType: 'voter',
          resourceId: voter.id,
          metadata: {
            householdId: household.id,
            applied: fields.filter((f) => f.status === 'applied').length,
            rejected: fields.filter((f) => f.status === 'rejected').length,
          },
        },
        tx,
      );
      return { id: voter.id, householdId: household.id, duplicate: false, fields };
    };
    return outer ? write(outer) : this.prisma.$transaction(write);
  }

  /**
   * Writes the address and/or a location reading, with a consent record for
   * the location created first (in the same transaction).
   */
  private async writeAddressAndLocation(
    tx: Tx,
    scope: Scope,
    actor: Actor,
    householdId: string,
    input: {
      address?: AddressDto;
      addressBaseVersion: string | null;
      location?: LocationDto;
      locationBaseVersion: string | null;
    },
  ): Promise<HouseholdUpdated['results']> {
    const changes: (FieldChange & { name: 'address' | 'location' })[] = [];
    if (input.address) {
      changes.push({
        name: 'address',
        entityType: 'household',
        entityId: householdId,
        fieldKey: ADDRESS_FIELD,
        value: { ...input.address },
        baseVersion: input.addressBaseVersion,
      });
    }
    if (input.location) {
      const { consent, ...reading } = input.location;
      const agreed = await tx.consent.create({
        data: {
          subjectHouseholdId: householdId,
          purpose: LOCATION_FIELD,
          noticeVersion: consent.noticeVersion,
          capturedMethod: consent.method,
          capturedById: actor.userId,
          capturedAt: new Date(reading.capturedAt),
        },
      });
      changes.push({
        name: 'location',
        entityType: 'household',
        entityId: householdId,
        fieldKey: LOCATION_FIELD,
        value: { ...reading },
        baseVersion: input.locationBaseVersion,
        consentId: agreed.id,
        collectedAt: new Date(reading.capturedAt),
      });
    }
    const results = await this.fieldValues.write(scope, actor.userId, changes, tx);
    return Object.fromEntries(changes.map((c, i) => [c.name, results[i]]));
  }

  /** A retried create: the same household if the caller can see it, else 409. */
  private async existing(
    db: Tx,
    scope: Scope,
    household: { id: string; pollingStationId: string; origin: string },
    pollingStationId: string,
  ): Promise<HouseholdDetail> {
    if (
      household.origin !== 'volunteer_added' ||
      household.pollingStationId !== pollingStationId ||
      !scope.boothIds.includes(household.pollingStationId)
    ) {
      throw new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'id is already used');
    }
    return this.households.get(scope, household.id, db);
  }
}

/** Trimmed parts only; empty parts are left out. */
function cleanAddress(address: AddressDto): AddressDto {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(address)) {
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
  }
  return clean;
}

const auditBase = (actor: Actor) => ({
  result: 'success' as const,
  actorId: actor.userId,
  sessionId: actor.sessionId ?? null,
  requestId: actor.requestId ?? null,
});
