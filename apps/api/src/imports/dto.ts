import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

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
