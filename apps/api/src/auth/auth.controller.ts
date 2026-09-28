import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { RequestOtpDto, type TokenPair, VerifyOtpDto } from './dto';
import { OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly otp: OtpService) {}

  /** Sends a sign-in code. Always 202, whether or not the phone is registered. */
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: RequestOtpDto): Promise<void> {
    await this.otp.request(body.phone);
  }

  /** Exchanges a correct code for an access token and a refresh token. */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() body: VerifyOtpDto): Promise<TokenPair> {
    return this.otp.verify(body.phone, body.code, body.deviceId);
  }
}
