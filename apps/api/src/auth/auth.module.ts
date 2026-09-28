import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { GeoScopeGuard } from '../authz/geo-scope.guard';
import { ScopeService } from '../authz/scope.service';
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
    ScopeService,
    // Global guards run in this order: first the access token (401), then
    // the caller's scope and @Roles() (403). Both skip @Public() routes.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: GeoScopeGuard },
    {
      provide: OTP_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('OTP_DEV_MODE', { infer: true })
          ? new LogOtpSender()
          : new UnconfiguredOtpSender(),
    },
  ],
  exports: [TokenService, ScopeService],
})
export class AuthModule {}
