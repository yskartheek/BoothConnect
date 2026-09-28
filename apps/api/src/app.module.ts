import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { loggerParams } from './config/logger';
import { DatabaseModule } from './database/database.module';
import { FieldValuesModule } from './field-values/field-values.module';
import { GeographyModule } from './geography/geography.module';
import { HealthModule } from './health/health.module';
import { HouseholdsModule } from './households/households.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { RedisModule } from './redis/redis.module';
import { SyncModule } from './sync/sync.module';
import { UsersModule } from './users/users.module';
import { VisitsModule } from './visits/visits.module';
import { VotersModule } from './voters/voters.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerParams({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
    }),
    CommonModule,
    DatabaseModule,
    RedisModule,
    AuditModule,
    IdempotencyModule,
    HealthModule,
    AuthModule,
    UsersModule,
    GeographyModule,
    FieldValuesModule,
    HouseholdsModule,
    VotersModule,
    VisitsModule,
    SyncModule,
  ],
})
export class AppModule {}
