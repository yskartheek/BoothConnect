import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { Env } from '../config/env';

/** Injection token for the shared ioredis client: `@Inject(REDIS) redis: Redis`. */
export const REDIS = Symbol('REDIS');

function createClient(config: ConfigService<Env, true>): Redis {
  // Connects in the background and keeps reconnecting if Redis goes away.
  const client = new Redis(config.get('REDIS_URL', { infer: true }), {
    connectTimeout: 2000,
    // A command sent while (re)connecting waits for the connection, so the
    // first request after startup doesn't fail. If Redis stays down, commands
    // are rejected after one reconnect attempt instead of hanging.
    maxRetriesPerRequest: 1,
  });
  // Failures surface through the commands (and the health check); without a
  // listener ioredis would log them as unhandled on every reconnect attempt.
  client.on('error', () => undefined);
  return client;
}

@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}

// One Redis connection for the whole API (OTP codes, rate limits, and later
// caches and queues).
@Global()
@Module({
  providers: [{ provide: REDIS, inject: [ConfigService], useFactory: createClient }, RedisShutdown],
  exports: [REDIS],
})
export class RedisModule {}
