import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { PageQuery } from '../common/pagination';

export class AuditEventsQuery extends PageQuery {
  /** Events by this user. */
  @IsOptional()
  @IsUUID()
  actorId?: string;

  /** An action (`import.file.confirm`), or a prefix ending in `*` (`import.*`). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9_.]+\*?$/, { message: 'action must look like "auth.login" or "import.*"' })
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resourceId?: string;

  @IsOptional()
  @IsIn(['success', 'failure', 'denied'])
  result?: string;

  /** From this time (inclusive), ISO 8601. */
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  /** Up to this time (exclusive), ISO 8601. */
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  /** Also check the hash chain of every event in the from/to range. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  verify?: boolean;
}
