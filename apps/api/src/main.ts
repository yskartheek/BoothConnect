import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import type { Env } from './config/env';
import { setupApiDocs } from './openapi/ui';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  if (config.get('NODE_ENV', { infer: true }) !== 'production' && setupApiDocs(app, API_PREFIX)) {
    app.get(Logger).log(`API docs at /${API_PREFIX}/docs`, 'Bootstrap');
  }
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  app.get(Logger).log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Configuration errors are expected here; print them without a stack trace.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
