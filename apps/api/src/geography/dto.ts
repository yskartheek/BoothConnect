import { Transform } from 'class-transformer';
import {
  IsBoolean,
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

export class CreateGeographyDto {
  @IsIn(MASTER_LEVELS)
  type!: MasterLevel;

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

  /** The State of a PC, the PC of an AC; none for a State. */
  @IsOptional()
  @IsUUID()
  parentId?: string;
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
