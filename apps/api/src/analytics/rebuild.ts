import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../app.module';
import { NodeStatsService } from './node-stats.service';

/**
 * Recomputes every node's analytics (`pnpm --filter api stats:rebuild`, after
 * `build`). Refreshes normally happen on their own after each change; this
 * is for repairs, and after changes the refresh doesn't follow (e.g. new
 * volunteer assignments).
 */
async function rebuild(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const started = Date.now();
  await app.get(NodeStatsService).rebuildAll();
  app.get(Logger).log(`node_stats rebuilt in ${Date.now() - started} ms`, 'StatsRebuild');
  await app.close();
}

rebuild().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
