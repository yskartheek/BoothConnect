import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { PageQuery } from '../common/pagination';
import { Role } from '../generated/prisma/enums';
import { GRANTABLE_ROLES, type GrantableRole } from './users.service';

const E164 = /^\+[1-9]\d{7,14}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UsersQueryDto extends PageQuery {
  /** Users with an assignment at or below this node (in your area). */
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @IsOptional()
  @IsIn(Object.values(Role))
  role?: Role;

  /** Part of the name, or the start of the phone number. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  /** true: only users with an active assignment in your area. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}

export class GrantDto {
  /** admin, campaign_manager or volunteer. A volunteer is assigned to a polling station. */
  @IsIn(GRANTABLE_ROLES)
  role!: GrantableRole;

  /** A node at or below one of your admin assignments. */
  @IsUUID()
  geographyNodeId!: string;

  /** Default: now. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  /** Default: open-ended. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Date)
  @IsDate()
  validUntil?: Date | null;
}

export class CreateUserDto extends GrantDto {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  /** International format, e.g. +919876543210. Used to sign in. */
  @Matches(E164, { message: 'phone must be in international format, e.g. +919876543210' })
  phone!: string;

  /** e.g. en, te. Default: en. */
  @IsOptional()
  @Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, { message: 'preferredLanguage must be a language code' })
  @MaxLength(10)
  preferredLanguage?: string;
}

export class CreateRoleAssignmentDto extends GrantDto {
  @IsUUID()
  userId!: string;
}
