import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  Min,
  ValidateNested,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

import { MASTER_LEVELS, type MasterLevel } from './master-data';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class MasterImportDto {
  /**
   * The CSV: columns `level` (state, pc, ac), `code`, `name`,
   * `reservation` (optional), `parent_code` (a PC's State code, an AC's PC
   * code) and `state_code` (optional, to tell apart PCs with the same code).
   */
  @IsString()
  @Length(1, 1_000_000)
  csv!: string;

  /** false (default): only report what would change. true: save it (only when no row has an error). */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  /** Needed only by admins of more than one program. */
  @IsOptional()
  @IsUUID()
  programId?: string;
}

export const STATION_TYPES = ['general', 'male', 'female'] as const;

export class CreateGeographyDto {
  /** state, pc or ac; or polling_station for an auxiliary station added by hand (#172). */
  @IsIn([...MASTER_LEVELS, 'polling_station'])
  type!: MasterLevel | 'polling_station';

  /** Official number: S29, 6, 40… */
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  @Matches(/^[^/]+$/, { message: 'code must not contain "/"' })
  code!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  /** e.g. GEN, SC, ST. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  reservation?: string;

  /** The State of a PC, the PC of an AC, the part of a polling station; none for a State. */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** Polling stations: must be true (a part's main station comes from its roll). */
  @IsOptional()
  @IsBoolean()
  isAuxiliary?: boolean;

  /** Polling stations: where it is, as printed or announced. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  address?: string;

  /** Polling stations: general (default), male or female. */
  @IsOptional()
  @IsIn(STATION_TYPES)
  stationType?: (typeof STATION_TYPES)[number];
}

export class UpdateGeographyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name?: string;

  /** null removes it. */
  @ValidateIf((o: UpdateGeographyDto) => o.reservation !== undefined && o.reservation !== null)
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  reservation?: string | null;
}

export class SerialRangeDto {
  @IsInt()
  @Min(1)
  from!: number;

  @IsInt()
  @Min(1)
  to!: number;
}

export class CoverageDto {
  /** Section numbers the station takes, e.g. [2]. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  sections?: number[];

  /** A serial number range the station takes, both ends included. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SerialRangeDto)
  serials?: SerialRangeDto;
}

export class SetCoverageDto {
  /** null clears it: the station then takes no one, and its voters go back to the main station. */
  @ValidateIf((o: SetCoverageDto) => o.coverage !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => CoverageDto)
  coverage!: CoverageDto | null;
}
