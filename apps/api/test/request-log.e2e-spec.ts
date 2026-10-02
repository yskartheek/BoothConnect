import { Writable } from 'node:stream';

import { Controller, Get, Module, Query } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';
import request from 'supertest';

import { loggerParams } from '../src/config/logger';

// The API's request logging, as configured (#210): a search doesn't reach
// the log, through the URL, the query or the Referer. Synthetic data only.
const lines: string[] = [];
const capture = new Writable({
  write(chunk: Buffer, _encoding, done) {
    lines.push(chunk.toString());
    done();
  },
});

@Controller('households')
class SearchController {
  @Get()
  search(@Query('q') q?: string) {
    return { items: [], q: q?.length ?? 0 };
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: [
        loggerParams({ NODE_ENV: 'production', LOG_LEVEL: 'info' }).pinoHttp as Options,
        capture,
      ],
    }),
  ],
  controllers: [SearchController],
})
class LoggedModule {}

describe('request log', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [LoggedModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a search by name, house number or phone leaves no trace in the log', async () => {
    lines.length = 0;
    for (const term of ['Synthetic Lakshmi', 'H NO 1-3', '+919999900101']) {
      await request(app.getHttpServer())
        .get('/households')
        .query({ q: term, boothId: 'booth-1', limit: 20 })
        .set('Referer', `http://localhost:3000/voters?q=${encodeURIComponent(term)}`)
        .set('Authorization', 'Bearer synthetic-token')
        .expect(200);
    }
    const log = lines.join('');
    const entries = lines.map(
      (line) => JSON.parse(line) as { req?: { url: string; query: Record<string, unknown> } },
    );
    const requests = entries.filter((e) => e.req);
    expect(requests).toHaveLength(3);

    for (const term of ['Lakshmi', 'H NO', 'H%20NO', 'H+NO', '1-3', '9999900101']) {
      expect(log).not.toContain(term);
    }
    expect(log).not.toContain('synthetic-token');
    // What's useful stays: the path, IDs and numbers.
    expect(requests[0]!.req).toMatchObject({
      url: '/households?q=[redacted]&boothId=booth-1&limit=20',
      query: { q: '[redacted]', boothId: 'booth-1', limit: '20' },
    });
  });
});
