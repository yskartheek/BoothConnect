import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { type Page, PageQuery } from '../common/pagination';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { AddMemberDto, CreateHouseholdDto, UpdateHouseholdDto } from './dto';
import {
  type HouseholdCreated,
  type HouseholdUpdated,
  HouseholdWritesService,
  type MemberCreated,
} from './household-writes.service';
import {
  type HouseholdDetail,
  type HouseholdSummary,
  HouseholdsService,
  VISIT_STATUSES,
  type VisitStatus,
} from './households.service';

export class ListHouseholdsQuery extends PageQuery {
  /** One booth (polling station); default: all of the caller's booths. */
  @IsOptional()
  @IsUUID()
  boothId?: string;

  /** Address, house number, member name or EPIC number. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(VISIT_STATUSES)
  status?: VisitStatus;
}

@Controller('households')
export class HouseholdsController {
  constructor(
    private readonly households: HouseholdsService,
    private readonly writes: HouseholdWritesService,
  ) {}

  @Get()
  list(
    @CurrentScope() scope: Scope,
    @Query() query: ListHouseholdsQuery,
  ): Promise<Page<HouseholdSummary>> {
    return this.households.list(scope, query);
  }

  @Get(':id')
  get(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HouseholdDetail> {
    return this.households.get(scope, id);
  }

  /** A household not on the roll, in one of the caller's booths. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @Roles('volunteer', 'admin')
  create(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: CreateHouseholdDto,
  ): Promise<HouseholdCreated> {
    return this.writes.create(scope, actorOf(user, req), dto);
  }

  /** Edit the address and/or capture a location. */
  @Patch(':id')
  @Idempotent()
  @Roles('volunteer', 'admin')
  update(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHouseholdDto,
  ): Promise<HouseholdUpdated> {
    return this.writes.update(scope, actorOf(user, req), id, dto);
  }

  /** A member not on the official list. */
  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @Roles('volunteer', 'admin')
  addMember(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ): Promise<MemberCreated> {
    return this.writes.addMember(scope, actorOf(user, req), id, dto);
  }
}
