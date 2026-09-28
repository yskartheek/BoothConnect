import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
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
    // Every route needs a valid access token unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
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
