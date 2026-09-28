import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ArrayMaxSize,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { ConsentMethod } from '../generated/prisma/enums';

/** Keys as stored (and as the app's address form names them). */
export class AddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  house_no?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  street?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  area?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'pin_code must be 6 digits' })
  pin_code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  landmark?: string;
}

/** The household's agreement to store its location, captured with it. */
export class LocationConsentDto {
  @IsString()
  @Length(1, 32)
  noticeVersion!: string;

  @IsIn([ConsentMethod.in_person_verbal, ConsentMethod.in_person_signed])
  method!: ConsentMethod;
}

/** One reading from the phone, taken when the volunteer taps the button. */
export class LocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyM?: number;

  @IsDateString({ strict: true })
  capturedAt!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => LocationConsentDto)
  consent!: LocationConsentDto;
}

export class CreateHouseholdDto {
  /** Generated on the phone, so later offline changes can refer to it. */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** One of the caller's booths. */
  @IsUUID()
  pollingStationId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}

export class UpdateHouseholdDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  /** The address value ID the phone last saw (null: none); required with `address`. */
  @ValidateIf((dto: UpdateHouseholdDto) => dto.address !== undefined)
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  addressBaseVersion?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  /** The location value ID the phone last saw (null: none); required with `location`. */
  @ValidateIf((dto: UpdateHouseholdDto) => dto.location !== undefined)
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  locationBaseVersion?: string | null;
}

export class MemberFieldDto {
  @IsString()
  @Length(1, 64)
  fieldKey!: string;

  @IsDefined()
  value!: unknown;

  /** Required for consent-gated fields such as caste/community. */
  @IsOptional()
  @IsUUID()
  consentId?: string;
}

export class AddMemberDto {
  /** Generated on the phone, so later offline changes can refer to it. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(130)
  age?: number;

  /** One of the gender field's options. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  gender?: string;

  /** Other member fields (mobile number, occupation…). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MemberFieldDto)
  fields?: MemberFieldDto[];
}
