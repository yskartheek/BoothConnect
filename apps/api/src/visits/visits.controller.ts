import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { CreateVisitDto } from './dto';
import { type VisitCreated, VisitsService } from './visits.service';

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  /**
   * Records a visit (and any consents and field changes made during it).
   * 201 also for a visit already stored under this clientId (`duplicate: true`).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @Roles('volunteer', 'admin')
  create(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: CreateVisitDto,
  ): Promise<VisitCreated> {
    return this.visits.create(scope, actorOf(user, req), dto);
  }
}
