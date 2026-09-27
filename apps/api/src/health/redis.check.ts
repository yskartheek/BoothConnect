import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { Env } from '../config/env';
import type { HealthCheck } from './health-check';

@Injectable()
export class RedisHealthCheck implements HealthCheck, OnModuleDestroy {
  readonly name = 'redis';
  private readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    // Connects in the background and keeps reconnecting if Redis goes away.
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      // Fail fast while disconnected instead of queueing commands.
      enableOfflineQueue: false,
    });
    // Connection errors surface through check(); without a listener ioredis
    // would log them as unhandled on every reconnect attempt.
    this.client.on('error', () => undefined);
  }

  async check(): Promise<void> {
    await this.client.ping();
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
