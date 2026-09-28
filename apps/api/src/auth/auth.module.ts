import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { LogOtpSender, OTP_SENDER, UnconfiguredOtpSender } from './otp-sender';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Module({
  // Secrets and lifetimes are passed per call by TokenService.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    OtpService,
    TokenService,
    {
      provide: OTP_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('OTP_DEV_MODE', { infer: true })
          ? new LogOtpSender()
          : new UnconfiguredOtpSender(),
    },
  ],
  exports: [TokenService],
})
export class AuthModule {}
