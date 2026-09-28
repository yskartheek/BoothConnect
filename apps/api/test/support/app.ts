import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/database/prisma.service';

export interface TestApp {
  app: NestExpressApplication;
  /** A supertest agent for the running app: `http().get('/v1/health')`. */
  http: () => ReturnType<typeof request>;
  /** The app's own database connection (this test file's database). */
  prisma: PrismaService;
  close: () => Promise<void>;
}

/**
 * The full API, configured exactly as in main.ts, against this test file's own
 * database and the real Redis. Requests commit, so use it for HTTP tests and
 * `inRollback` for database-only tests. `customize` can replace providers,
 * e.g. `(b) => b.overrideProvider(OTP_SENDER).useValue(fakeSender)`.
 */
export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<TestApp> {
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    close: () => app.close(),
  };
}
