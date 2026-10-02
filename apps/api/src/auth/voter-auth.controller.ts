import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { toApiError } from '../common/errors/all-exceptions.filter';
import { ApiNoBody, ApiResult } from '../openapi/api-result';
import { Public } from './decorators';
import { RequestVoterOtpDto, type TokenPair, VerifyVoterOtpDto } from './dto';
import { OtpService } from './otp.service';

const requestIdOf = (req: Request & { id?: unknown }) =>
  typeof req.id === 'string' ? req.id : null;

/**
 * Voter sign-in (#223): the voter ID (EPIC) plus a code sent to the mobile
 * number on the voter's record. Refresh and sign-out are the staff
 * endpoints (`/auth/refresh`, `/auth/logout`).
 */
@ApiTags('Auth')
@Controller('voter-auth')
export class VoterAuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Sends a sign-in code if an active voter has this EPIC and this phone is
   * their mobile number on record. Always 202, so it reveals nothing about
   * who is on the roll.
   */
  @Public()
  @ApiNoBody(202)
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: RequestVoterOtpDto): Promise<void> {
    await this.otp.requestVoter(body.epic, body.phone);
  }

  /**
   * Exchanges a correct code for a voter's token pair. A wrong code, an
   * unknown EPIC and a phone that isn't on the record are all `OTP_INVALID`.
   * Every attempt is audited (`auth.login`), without the EPIC, the phone or
   * the code.
   */
  @Public()
  @ApiResult('TokenPair')
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() body: VerifyVoterOtpDto,
    @Req() req: Request & { id?: unknown },
  ): Promise<TokenPair> {
    const requestId = requestIdOf(req);
    try {
      const { userId, sessionId, voterId, tokens } = await this.otp.verifyVoter(
        body.epic,
        body.phone,
        body.code,
        body.deviceId,
      );
      await this.audit.record({
        action: 'auth.login',
        resourceType: 'session',
        resourceId: sessionId,
        result: 'success',
        actorId: userId,
        sessionId,
        requestId,
        metadata: { kind: 'voter', voterId },
      });
      return tokens;
    } catch (error) {
      await this.audit.record({
        action: 'auth.login',
        resourceType: 'session',
        result: 'failure',
        requestId,
        metadata: { kind: 'voter', reason: toApiError(error).code },
      });
      throw error;
    }
  }
}
