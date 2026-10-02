import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { NodeStatsService } from '../src/analytics/node-stats.service';
import { AppModule } from '../src/app.module';
import { API_PREFIX, configureApp } from '../src/app.setup';
import { setupApiDocs } from '../src/openapi/ui';

// Swagger UI (#78): served outside production only, from the committed
// docs/api/openapi.json. Runs without Docker: the analytics refresh, the
// only part that reaches the database at start-up, is left out.
describe('API docs at /v1/docs', () => {
  async function start(nodeEnv: string): Promise<[NestExpressApplication, boolean]> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NodeStatsService)
      .useValue({})
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    const served = setupApiDocs(app, API_PREFIX, nodeEnv);
    await app.init();
    return [app, served];
  }

  it('serves Swagger UI and the spec outside production', async () => {
    const [app, served] = await start('development');
    try {
      expect(served).toBe(true);
      const page = await request(app.getHttpServer()).get('/v1/docs/').expect(200);
      expect(page.text).toContain('swagger-ui');
      const spec = await request(app.getHttpServer()).get('/v1/docs/openapi.json').expect(200);
      const document = spec.body as { openapi: string; paths: Record<string, unknown> };
      expect(document.openapi).toMatch(/^3\./);
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining(['/v1/auth/otp/verify', '/v1/sync/pull', '/v1/sync/push']),
      );
    } finally {
      await app.close();
    }
  });

  it('is not served in production', async () => {
    const [app, served] = await start('production');
    try {
      expect(served).toBe(false);
      const res = await request(app.getHttpServer()).get('/v1/docs/').expect(404);
      expect((res.body as { code: string }).code).toBe('NOT_FOUND');
      await request(app.getHttpServer()).get('/v1/docs/openapi.json').expect(404);
    } finally {
      await app.close();
    }
  });
});
