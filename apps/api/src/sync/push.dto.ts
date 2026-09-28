import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { ConsentMethod, FieldEntity } from '../generated/prisma/enums';
import { AddMemberDto, CreateHouseholdDto, UpdateHouseholdDto } from '../households/dto';
import { CreateVisitDto } from '../visits/dto';

export const MUTATION_TYPES = [
  'visit.create',
  'field.change',
  'consent.capture',
  'household.create',
  'household.update',
  'member.create',
  'conflict.resolve',
] as const;
export type MutationType = (typeof MUTATION_TYPES)[number];

export const MAX_BATCH = 200;

export class MutationDto {
  /**
   * Made on the phone, one per queued change and reused on every retry of
   * it, like an Idempotency-Key.
   */
  @Matches(/^[A-Za-z0-9_-]{8,128}$/, { message: 'key must be 8-128 letters, digits, "_" or "-"' })
  key!: string;

  @IsIn(MUTATION_TYPES)
  type!: MutationType;

  /** Checked against the type's own shape, item by item. */
  @IsObject()
  payload!: Record<string, unknown>;
}

export class SyncPushDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => MutationDto)
  mutations!: MutationDto[];
}

// --- Payloads ---------------------------------------------------------------

/** A single field of a member or household (the base_version rule applies). */
export class FieldChangePayload {
  @IsIn(Object.values(FieldEntity))
  entityType!: FieldEntity;

  @IsUUID()
  entityId!: string;

  @IsString()
  @Length(1, 64)
  fieldKey!: string;

  @IsDefined()
  value!: unknown;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  baseVersion!: string | null;

  @IsOptional()
  @IsUUID()
  consentId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  collectedAt?: string;
}

/** A consent given on the doorstep, before the values it covers are sent. */
export class ConsentCapturePayload {
  /** Made on the phone, so later items in the batch can name it as `consentId`. */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** Exactly one of voterId or householdId. */
  @IsOptional()
  @IsUUID()
  voterId?: string;

  @IsOptional()
  @IsUUID()
  householdId?: string;

  /** A field key (e.g. "caste_community") or "household_location". */
  @IsString()
  @Length(1, 64)
  purpose!: string;

  @IsString()
  @Length(1, 32)
  noticeVersion!: string;

  @IsIn([ConsentMethod.in_person_verbal, ConsentMethod.in_person_signed])
  method!: ConsentMethod;

  @IsOptional()
  @IsDateString({ strict: true })
  capturedAt?: string;
}

export class HouseholdUpdatePayload extends UpdateHouseholdDto {
  @IsUUID()
  id!: string;
}

export class MemberCreatePayload extends AddMemberDto {
  @IsUUID()
  householdId!: string;
}

export class ConflictResolvePayload {
  /** Either value of the conflict. */
  @IsUUID()
  conflictId!: string;

  @IsUUID()
  keepFieldValueId!: string;
}

export const PAYLOADS = {
  'visit.create': CreateVisitDto,
  'field.change': FieldChangePayload,
  'consent.capture': ConsentCapturePayload,
  'household.create': CreateHouseholdDto,
  'household.update': HouseholdUpdatePayload,
  'member.create': MemberCreatePayload,
  'conflict.resolve': ConflictResolvePayload,
} as const satisfies Record<MutationType, new () => object>;
