import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { CurrentScope } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { type Page, PageQuery } from '../common/pagination';
import { GeographyNodeType } from '../generated/prisma/enums';
import {
  type GeographyNodeDetail,
  type GeographyNodeView,
  GeographyService,
} from './geography.service';

export class ListGeographiesQuery extends PageQuery {
  /** List this node's children; omit for the top level (states). */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsEnum(GeographyNodeType)
  type?: GeographyNodeType;

  /** Start of the code (e.g. "408") or part of the name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

// Drives the State → PC → AC → Part → Booth dropdowns in both apps.
@Controller('geographies')
export class GeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Get()
  list(
    @CurrentScope() scope: Scope,
    @Query() query: ListGeographiesQuery,
  ): Promise<Page<GeographyNodeView>> {
    return this.geography.list(scope, query);
  }

  @Get(':id')
  get(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GeographyNodeDetail> {
    return this.geography.get(scope, id);
  }
}
