import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { type MemberEdited, VoterWritesService } from './voter-writes.service';
import { type VoterDetail, VotersService } from './voters.service';
import { ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../openapi/api-result';

export class VoterQuery {
  /** Include every earlier value of each field. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  history?: boolean;
}

export class MemberEditDto {
  @IsString()
  @Length(1, 64)
  fieldKey!: string;

  /** Checked against the field's type by the field-value service. */
  @IsDefined()
  value!: unknown;

  /** The value ID the phone last saw for this field; null if it saw none. */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  baseVersion!: string | null;

  /** Required for consent-gated fields such as caste/community. */
  @IsOptional()
  @IsUUID()
  consentId?: string;
}

export class EditMemberDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MemberEditDto)
  fields!: MemberEditDto[];
}

@ApiTags('Voters')
@Controller('voters')
export class VotersController {
  constructor(
    private readonly voters: VotersService,
    private readonly writes: VoterWritesService,
  ) {}

  @ApiResult('VoterDetail')
  @Get(':id')
  get(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VoterQuery,
  ): Promise<VoterDetail> {
    return this.voters.get(scope, actorOf(user, req), id, query.history ?? false);
  }

  /** Edit member details; each field is `applied`, `conflict` or `rejected`. */
  @ApiResult('MemberEdited')
  @Patch(':id')
  @Idempotent()
  @Roles('volunteer', 'admin')
  edit(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditMemberDto,
  ): Promise<MemberEdited> {
    return this.writes.edit(scope, actorOf(user, req), id, dto.fields);
  }
}
