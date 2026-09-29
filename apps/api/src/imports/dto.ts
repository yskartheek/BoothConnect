import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PageQuery } from '../common/pagination';

export class CreateBatchDto {
  /** The State, PC, AC or Part the files belong under (in the caller's scope). */
  @IsUUID()
  targetNodeId!: string;
}

export class UploadRequestDto {
  /** The file's name on the admin's computer; must end in .pdf or .zip. */
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  contentType?: string;
}

export class StartUploadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => UploadRequestDto)
  files!: UploadRequestDto[];
}

export class UploadedPartDto {
  @IsInt()
  @Min(1)
  @Max(10_000)
  partNumber!: number;

  /** The ETag header S3 returned for the part. */
  @IsString()
  @Length(1, 200)
  etag!: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => UploadedPartDto)
  parts!: UploadedPartDto[];
}

const IMPORT_ROW_STATUSES = ['accepted', 'warning', 'rejected'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PreviewQuery extends PageQuery {
  /** Only rows with these statuses (comma-separated or repeated). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsIn(IMPORT_ROW_STATUSES, { each: true })
  status?: (typeof IMPORT_ROW_STATUSES)[number][];

  /** Only rows with a field read with low confidence (and not corrected since). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  lowConfidence?: boolean;
}

/**
 * Corrected values for one row. Only the fields given are changed; a value
 * equal to the extracted one removes the correction. `houseNumber` and
 * `marker` may be null (no house number; an active entry).
 */
export class RowCorrectionValuesDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}\d{7}$/, { message: 'epic must be 3 letters and 7 digits' })
  epic?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsIn(['father', 'mother', 'husband', 'other'])
  relationType?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  relativeName?: string;

  @ValidateIf((o: RowCorrectionValuesDto) => o.houseNumber !== undefined && o.houseNumber !== null)
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  houseNumber?: string | null;

  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(120)
  age?: number;

  @IsOptional()
  @IsIn(['male', 'female', 'third_gender'])
  gender?: string;

  @ValidateIf((o: RowCorrectionValuesDto) => o.marker !== undefined && o.marker !== null)
  @IsIn(['deleted', 'modified'])
  marker?: 'deleted' | 'modified' | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  sectionNumber?: number;
}

export class CorrectRowDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RowCorrectionValuesDto)
  values?: RowCorrectionValuesDto;

  /** true rejects the row (it won't be imported); false takes the rejection back. */
  @IsOptional()
  @IsBoolean()
  rejected?: boolean;

  /** Why the row is rejected; shown to other reviewers. */
  @ValidateIf((o: CorrectRowDto) => o.rejected === true && o.reason !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  reason?: string;
}

export class ConfirmFileDto {
  /**
   * Confirm although the voters don't add up to the totals printed on the
   * roll (after the admin has checked why).
   */
  @IsOptional()
  @IsBoolean()
  acceptTotalsMismatch?: boolean;
}
