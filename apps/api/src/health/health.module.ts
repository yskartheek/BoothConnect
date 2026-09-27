import { Module } from '@nestjs/common';

import { DatabaseHealthCheck } from './database.check';
import { HEALTH_CHECKS, type HealthCheck } from './health-check';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisHealthCheck } from './redis.check';

@Module({
  controllers: [HealthController],
  providers: [
    DatabaseHealthCheck,
    RedisHealthCheck,
    {
      provide: HEALTH_CHECKS,
      useFactory: (database: HealthCheck, redis: HealthCheck) => [database, redis],
      inject: [DatabaseHealthCheck, RedisHealthCheck],
    },
    HealthService,
  ],
})
export class HealthModule {}
