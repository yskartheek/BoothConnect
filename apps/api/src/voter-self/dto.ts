import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class VoterDetailEditDto {
  /** One of the details a voter may share (`shareable` in `GET /voter/me`). */
  @IsString()
  @Length(1, 64)
  fieldKey!: string;

  /** Checked against the field's type by the field-value service. */
  @IsDefined()
  value!: unknown;

  /** The value ID the app last showed for this detail; null if there was none. */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  baseVersion!: string | null;
}

export class EditVoterDetailsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => VoterDetailEditDto)
  fields!: VoterDetailEditDto[];
}
