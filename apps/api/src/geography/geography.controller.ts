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
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import { actorOf } from '../common/actor';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import type { Scope } from '../authz/scope.service';
import { type Page, PageQuery } from '../common/pagination';
import { GeographyNodeType } from '../generated/prisma/enums';
import {
  type GeographyNodeDetail,
  type GeographyNodeView,
  GeographyService,
} from './geography.service';
import { CreateGeographyDto, MasterImportDto, UpdateGeographyDto } from './dto';
import {
  type MasterImportReport,
  MasterDataService,
  type MasterNodeView,
} from './master-data.service';
import { ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../openapi/api-result';

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
@ApiTags('Geographies')
@Controller('geographies')
export class GeographyController {
  constructor(
    private readonly geography: GeographyService,
    private readonly masterData: MasterDataService,
  ) {}

  @ApiResult('GeographyNodePage')
  @Get()
  list(
    @CurrentScope() scope: Scope,
    @Query() query: ListGeographiesQuery,
  ): Promise<Page<GeographyNodeView>> {
    return this.geography.list(scope, query);
  }

  @ApiResult('GeographyNodeDetail')
  @Get(':id')
  get(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GeographyNodeDetail> {
    return this.geography.get(scope, id);
  }

  /**
   * The State → PC → AC master data as a CSV (#100): a preview by default,
   * saved with `confirm: true` when no row has an error. Creates and
   * renames; never deletes.
   */
  @ApiResult('MasterImportReport')
  @Post('imports')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @Idempotent()
  importMasterData(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: MasterImportDto,
  ): Promise<MasterImportReport> {
    return this.masterData.importCsv(
      scope,
      actorOf(user, req),
      dto.csv,
      dto.confirm ?? false,
      dto.programId,
    );
  }

  /** Adds one State, PC or AC (parts and stations come from roll imports). */
  @ApiResult('MasterNodeView', HttpStatus.CREATED)
  @Post()
  @Roles('admin')
  @Idempotent()
  create(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: CreateGeographyDto,
  ): Promise<MasterNodeView> {
    return this.masterData.create(scope, actorOf(user, req), dto);
  }

  /** Renames a node or changes its reservation. */
  @ApiResult('MasterNodeView')
  @Patch(':id')
  @Roles('admin')
  @Idempotent()
  update(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGeographyDto,
  ): Promise<MasterNodeView> {
    return this.masterData.update(scope, actorOf(user, req), id, dto);
  }
}
