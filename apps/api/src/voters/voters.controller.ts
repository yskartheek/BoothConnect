import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

import { CurrentScope } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { type VoterDetail, VotersService } from './voters.service';

export class VoterQuery {
  /** Include every earlier value of each field. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  history?: boolean;
}

@Controller('voters')
export class VotersController {
  constructor(private readonly voters: VotersService) {}

  @Get(':id')
  get(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VoterQuery,
  ): Promise<VoterDetail> {
    return this.voters.get(scope, id, query.history ?? false);
  }
}
