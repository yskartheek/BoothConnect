import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DatabaseHealthCheck } from '../src/health/database.check';
import { RedisHealthCheck } from '../src/health/redis.check';

// Real app wiring (config, logging, prefix, routing) with the database and
// Redis checks replaced, so this runs without Docker. Environment variables
// come from test/setup-env.cjs.
describe('GET /v1/health', () => {
  let app: NestExpressApplication;
  const redis = { name: 'redis', check: jest.fn<Promise<void>, []>() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseHealthCheck)
      .useValue({ name: 'database', check: () => Promise.resolve() })
      .overrideProvider(RedisHealthCheck)
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with the status of each dependency', async () => {
    redis.check.mockResolvedValue();
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: {
        database: { status: 'up', latencyMs: expect.any(Number) },
        redis: { status: 'up', latencyMs: expect.any(Number) },
      },
    });
  });

  it('returns 503 when a dependency is down', async () => {
    redis.check.mockRejectedValue(new Error('down'));
    const res = await request(app.getHttpServer()).get('/v1/health').expect(503);
    expect(res.body).toMatchObject({ status: 'error', checks: { redis: { status: 'down' } } });
  });

  it('adds a request ID, or echoes a valid one from the caller', async () => {
    redis.check.mockResolvedValue();
    const generated = await request(app.getHttpServer()).get('/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const echoed = await request(app.getHttpServer())
      .get('/v1/health')
      .set('X-Request-Id', 'client-123');
    expect(echoed.headers['x-request-id']).toBe('client-123');
  });

  it('serves nothing outside the /v1 prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('does not advertise the framework', async () => {
    redis.check.mockResolvedValue();
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
