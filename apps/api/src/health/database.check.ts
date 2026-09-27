import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import type { Env } from '../config/env';
import type { HealthCheck } from './health-check';

// Temporary: a plain pg pool until Prisma arrives, which will take over this check.
@Injectable()
export class DatabaseHealthCheck implements HealthCheck, OnModuleDestroy {
  readonly name = 'database';
  private readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: 1,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10_000,
    });
    // Idle-client errors (e.g. the database restarting) must not crash the API.
    this.pool.on('error', () => undefined);
  }

  async check(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
