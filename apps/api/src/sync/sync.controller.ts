import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { CurrentScope } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { DEFAULT_SYNC_LIMIT, MAX_SYNC_LIMIT, type SyncPage, SyncService } from './sync.service';

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

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('pull')
  pull(@CurrentScope() scope: Scope, @Query() query: SyncPullQuery): Promise<SyncPage> {
    return this.sync.pull(scope, query.since, query.limit ?? DEFAULT_SYNC_LIMIT);
  }
}
