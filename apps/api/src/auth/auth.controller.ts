import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { type AuthUser, CurrentUser, Public } from './decorators';
import { RefreshDto, RequestOtpDto, type TokenPair, VerifyOtpDto } from './dto';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  /** Sends a sign-in code. Always 202, whether or not the phone is registered. */
  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: RequestOtpDto): Promise<void> {
    await this.otp.request(body.phone);
  }

  /** Exchanges a correct code for an access token and a refresh token. */
  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() body: VerifyOtpDto): Promise<TokenPair> {
    return this.otp.verify(body.phone, body.code, body.deviceId);
  }

  /** Rotates the refresh token and issues a new access token. */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto): Promise<TokenPair> {
    return this.tokens.refresh(body.refreshToken);
  }

  /** Signs this device out: its session and all its tokens stop working. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.tokens.revoke(user.sessionId);
  }
}
