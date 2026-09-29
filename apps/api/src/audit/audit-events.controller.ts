import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { Roles } from '../authz/decorators';
import { actorOf } from '../common/actor';
import { AuditEventsQuery } from './audit-events.dto';
import { type AuditEventsPage, AuditEventsService } from './audit-events.service';
import { ApiTags } from '@nestjs/swagger';
import { ApiResult } from '../openapi/api-result';

/** The audit log (admins only; reading it is audited too). */
@ApiTags('Audit')
@Controller('audit-events')
@Roles('admin')
export class AuditEventsController {
  constructor(private readonly events: AuditEventsService) {}

  @ApiResult('AuditEventsPage')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Query() query: AuditEventsQuery,
  ): Promise<AuditEventsPage> {
    return this.events.list(actorOf(user, req), query);
  }
}
