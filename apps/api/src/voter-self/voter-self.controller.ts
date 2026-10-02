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
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { ApiResult } from '../openapi/api-result';
import { EditVoterDetailsDto } from './dto';
import {
  type VoterConsent,
  type VoterConsents,
  type VoterDetailsEdited,
  type VoterSelf,
  VoterSelfService,
  type VoterUpdates,
} from './voter-self.service';

/**
 * The signed-in voter's own record (#224). Only a voter's session may call
 * these, and the voter is always the session's: no ID is ever taken from the
 * request.
 */
@ApiTags('Voter self-service')
@Controller('voter/me')
@Roles('voter')
export class VoterSelfController {
  constructor(private readonly self: VoterSelfService) {}

  /** Official roll data, the voter's booth, and the details they share. Audited. */
  @ApiResult('VoterSelf')
  @Get()
  me(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
  ): Promise<VoterSelf> {
    return this.self.me(scope, actorOf(user, req));
  }

  /**
   * Changes shared details (mobile number, occupation, additional info). Each
   * is current at once, as shared by the voter, or a conflict; one result per
   * detail.
   */
  @ApiResult('VoterDetailsEdited')
  @Patch('details')
  @Idempotent()
  editDetails(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: EditVoterDetailsDto,
  ): Promise<VoterDetailsEdited> {
    return this.self.editDetails(scope, actorOf(user, req), dto.fields);
  }

  /** The consents the voter gave, newest first (#225). */
  @ApiResult('VoterConsents')
  @Get('consents')
  consents(@CurrentScope() scope: Scope): Promise<VoterConsents> {
    return this.self.consents(scope);
  }

  /**
   * Withdraws one of the voter's consents (#225): the values it covers stop
   * being used, and volunteers' phones delete them. Audited.
   */
  @ApiResult('VoterConsent')
  @Post('consents/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  withdrawConsent(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VoterConsent> {
    return this.self.withdrawConsent(scope, actorOf(user, req), id);
  }

  /** What happened to the voter's record, newest first. */
  @ApiResult('VoterUpdates')
  @Get('updates')
  updates(@CurrentScope() scope: Scope): Promise<VoterUpdates> {
    return this.self.updates(scope);
  }
}
