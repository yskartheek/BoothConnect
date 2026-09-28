import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { type ConflictResolved, ConflictsService } from './conflicts.service';

export class ResolveConflictDto {
  /** One of the conflicting values; it stays current. */
  @IsUUID()
  keepFieldValueId!: string;
}

@Controller('conflicts')
export class ConflictsController {
  constructor(private readonly conflicts: ConflictsService) {}

  /**
   * `:id` is either value of the conflict (as listed by sync pull). A second
   * call keeping the same value is a no-op (`already_resolved`).
   */
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles('volunteer', 'admin')
  resolve(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveConflictDto,
  ): Promise<ConflictResolved> {
    return this.conflicts.resolve(scope, actorOf(user, req), id, dto.keepFieldValueId);
  }
}
