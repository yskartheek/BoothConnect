import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';

import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import {
  AnalyticsService,
  type ChildrenBreakdown,
  type AnalyticsSummary,
  type Revisions,
} from './analytics.service';
import { FIGURE_KEYS } from './suppression';
import { ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../openapi/api-result';

export class ChildrenQuery {
  /** Sort the children by this figure (e.g. `electors.total`); default: by code. */
  @IsOptional()
  @IsIn(FIGURE_KEYS)
  metric?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/** Aggregate analytics for any node in the caller's area (#49; design §7). */
@ApiTags('Analytics')
@Controller('analytics')
@Roles('admin', 'campaign_manager')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @ApiResult('AnalyticsSummary')
  @Get('nodes/:id/summary')
  summary(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnalyticsSummary> {
    return this.analytics.summary(scope, id);
  }

  @ApiResult('ChildrenBreakdown')
  @Get('nodes/:id/children')
  children(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ChildrenQuery,
  ): Promise<ChildrenBreakdown> {
    return this.analytics.children(scope, id, query.metric, query.order);
  }

  @ApiResult('Revisions')
  @Get('nodes/:id/revisions')
  revisions(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Revisions> {
    return this.analytics.revisions(scope, id);
  }
}
