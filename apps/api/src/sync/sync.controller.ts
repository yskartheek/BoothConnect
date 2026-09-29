import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { SyncPushDto } from './push.dto';
import { type MutationResult, SyncPushService } from './push.service';
import { DEFAULT_SYNC_LIMIT, MAX_SYNC_LIMIT, type SyncPage, SyncService } from './sync.service';
import { ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../openapi/api-result';

export class SyncPullQuery {
  /**
   * The `cursor` of the previous response; omit for a full snapshot. It lists
   * the transactions running at pull time, so allow for a busy database.
   */
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  since?: string;

  /** Rows per page, across all record types. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SYNC_LIMIT)
  limit?: number;
}

@ApiTags('Sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly pushes: SyncPushService,
  ) {}

  @ApiResult('SyncPage')
  @Get('pull')
  pull(@CurrentScope() scope: Scope, @Query() query: SyncPullQuery): Promise<SyncPage> {
    return this.sync.pull(scope, query.since, query.limit ?? DEFAULT_SYNC_LIMIT);
  }

  /**
   * A batch of queued changes from the phone, applied in order; one result
   * per mutation. A bad item doesn't stop the others.
   */
  @ApiResult('SyncPushResult')
  @Post('push')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @Roles('volunteer', 'admin')
  async push(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: SyncPushDto,
  ): Promise<{ results: MutationResult[] }> {
    return { results: await this.pushes.push(scope, actorOf(user, req), dto.mutations) };
  }
}
