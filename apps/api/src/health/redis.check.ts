import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS } from '../redis/redis.module';
import type { HealthCheck } from './health-check';

@Injectable()
export class RedisHealthCheck implements HealthCheck {
  readonly name = 'redis';

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async check(): Promise<void> {
    await this.redis.ping();
  }
}
