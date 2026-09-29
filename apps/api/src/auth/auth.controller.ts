import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { Audited } from '../audit/audited';
import { toApiError } from '../common/errors/all-exceptions.filter';
import { PrismaService } from '../database/prisma.service';
import { type AuthUser, CurrentUser, Public } from './decorators';
import { RefreshDto, RequestOtpDto, type TokenPair, VerifyOtpDto } from './dto';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { ApiTags } from '@nestjs/swagger';
import { ApiNoBody, ApiResult } from '../openapi/api-result';

const requestIdOf = (req: Request & { id?: unknown }) =>
  typeof req.id === 'string' ? req.id : null;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Sends a sign-in code. Always 202, whether or not the phone is registered. */
  @Public()
  @ApiNoBody(202)
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: RequestOtpDto): Promise<void> {
    await this.otp.request(body.phone);
  }

  /**
   * Exchanges a correct code for an access token and a refresh token. Every
   * attempt is audited (`auth.login`), without the phone number or the code.
   */
  @Public()
  @ApiResult('TokenPair')
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: VerifyOtpDto, @Req() req: Request): Promise<TokenPair> {
    const requestId = requestIdOf(req);
    try {
      const { userId, sessionId, tokens } = await this.otp.verify(
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
      });
      return tokens;
    } catch (error) {
      // The attempt is attributed to the account if the phone has one (so
      // repeated failures on an account are visible), but the response and the
      // metadata stay the same either way.
      const user = await this.prisma.appUser.findUnique({
        where: { phone: body.phone },
        select: { id: true },
      });
      await this.audit.record({
        action: 'auth.login',
        resourceType: 'session',
        result: 'failure',
        actorId: user?.id,
        requestId,
        metadata: { reason: toApiError(error).code },
      });
      throw error;
    }
  }

  /** Rotates the refresh token and issues a new access token. */
  @Public()
  @ApiResult('TokenPair')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto): Promise<TokenPair> {
    return this.tokens.refresh(body.refreshToken);
  }

  /** Signs this device out: its session and all its tokens stop working. */
  @Audited({
    action: 'auth.logout',
    resourceType: 'session',
    resourceId: (req) => req.user?.sessionId,
  })
  @ApiNoBody(204)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.tokens.revoke(user.sessionId);
  }
}
