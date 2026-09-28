import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { ConsentMethod, FieldEntity, VisitOutcome } from '../generated/prisma/enums';

/** A client-chosen label linking a consent captured here to the field changes it covers. */
const REF = /^[A-Za-z0-9_-]{1,64}$/;

export class ConsentCaptureDto {
  @Matches(REF, { message: 'ref must be 1-64 letters, digits, "_" or "-"' })
  ref!: string;

  /** The member who agreed; omit for a household-level consent (e.g. location). */
  @IsOptional()
  @IsUUID()
  voterId?: string;

  /** A field key (e.g. "caste_community") or "household_location". */
  @IsString()
  @Length(1, 64)
  purpose!: string;

  @IsString()
  @Length(1, 32)
  noticeVersion!: string;

  @IsIn([ConsentMethod.in_person_verbal, ConsentMethod.in_person_signed])
  method!: ConsentMethod;
}

export class FieldChangeDto {
  @IsIn(Object.values(FieldEntity))
  entityType!: FieldEntity;

  /** The visit's household, or one of its members. */
  @IsUUID()
  entityId!: string;

  @IsString()
  @Length(1, 64)
  fieldKey!: string;

  /** Checked against the field's type by the field-value service. */
  @IsDefined()
  value!: unknown;

  /** The field_value ID the phone last saw; null if it saw none. */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  baseVersion!: string | null;

  /** An existing consent, or the `ref` of one captured in this visit. */
  @IsOptional()
  @IsUUID()
  consentId?: string;

  @IsOptional()
  @Matches(REF)
  consentRef?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  collectedAt?: string;
}

export class CreateVisitDto {
  /** Generated on the phone; the same visit is never stored twice. */
  @IsUUID()
  clientId!: string;

  @IsUUID()
  householdId!: string;

  @IsDateString({ strict: true })
  startedAt!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  completedAt?: string;

  @IsIn(Object.values(VisitOutcome))
  outcome!: VisitOutcome;

  @IsString()
  @Length(1, 32)
  formVersion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Members the volunteer met; each must belong to the household. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIdsMet?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ConsentCaptureDto)
  consents?: ConsentCaptureDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FieldChangeDto)
  fieldChanges?: FieldChangeDto[];
}
