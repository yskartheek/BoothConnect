import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { CurrentScope } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { type Page, PageQuery } from '../common/pagination';
import {
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
  constructor(private readonly households: HouseholdsService) {}

  @Get()
  list(
    @CurrentScope() scope: Scope,
    @Query() query: ListHouseholdsQuery,
  ): Promise<Page<HouseholdSummary>> {
    return this.households.list(scope, query);
  }
}
