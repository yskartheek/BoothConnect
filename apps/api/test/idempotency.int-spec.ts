import { randomUUID } from 'node:crypto';

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import type { ApiErrorBody } from '../src/common/errors/app.exception';
import { Idempotent } from '../src/idempotency/idempotency.interceptor';
import { createTestApp, type TestApp } from './support/app';
import { loginAs } from './support/auth';

const VOLUNTEER_A = '+919999900002';
const VOLUNTEER_B = '+919999900003';

class WriteDto {
  @IsString()
  note!: string;

  /** Milliseconds the handler takes, to create overlapping requests. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  delayMs?: number;

  @IsOptional()
  @IsString()
  failWith?: 'boom';
}

// A write that counts how often it really ran, for these tests only.
let runs = 0;
@Controller('test-idempotency')
class IdempotentTestController {
  @Idempotent()
  @Post('writes')
  async write(@Body() body: WriteDto): Promise<{ run: number; note: string }> {
    runs += 1;
    const run = runs;
    if (body.delayMs) await new Promise((resolve) => setTimeout(resolve, body.delayMs));
    if (body.failWith) throw new Error(body.failWith);
    return { run, note: body.note };
  }

  @Idempotent()
  @Post('no-content')
  @HttpCode(HttpStatus.NO_CONTENT)
  noContent(): void {
    runs += 1;
  }
}

describe('Idempotency-Key (real Postgres and Redis)', () => {
  let t: TestApp;
  const body = (res: { body: unknown }) => res.body as ApiErrorBody;

  beforeAll(async () => {
    t = await createTestApp(undefined, { controllers: [IdempotentTestController] });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('requires a well-formed Idempotency-Key header', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const missing = await http.post('/v1/test-idempotency/writes').send({ note: 'x' }).expect(400);
    expect(body(missing).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await http
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', 'has spaces!')
      .send({ note: 'x' })
      .expect(400);
  });

  it('a replay returns the stored response without running the write again', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const key = randomUUID();
    const send = () =>
      http.post('/v1/test-idempotency/writes').set('Idempotency-Key', key).send({ note: 'first' });

    const first = await send().expect(201);
    const runsAfterFirst = runs;
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const replay = await send().expect(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(runs).toBe(runsAfterFirst);
  });

  it('the same body with keys in another order is the same request', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const key = randomUUID();
    await http
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', key)
      .send({ note: 'n', delayMs: 0 })
      .expect(201);
    const replay = await http
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', key)
      .send({ delayMs: 0, note: 'n' })
      .expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('the same key with a different body is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const key = randomUUID();
    await http
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', key)
      .send({ note: 'one' })
      .expect(201);
    const reused = await http
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', key)
      .send({ note: 'two' })
      .expect(422);
    expect(body(reused).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('keys are per user: another user with the same key gets their own write', async () => {
    const a = await loginAs(t, VOLUNTEER_A);
    const b = await loginAs(t, VOLUNTEER_B);
    const key = randomUUID();
    const first = await a.http
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', key)
      .send({ note: 'same' })
      .expect(201);
    const other = await b.http
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', key)
      .send({ note: 'same' })
      .expect(201);
    expect(other.headers['idempotency-replayed']).toBeUndefined();
    expect((other.body as { run: number }).run).not.toBe((first.body as { run: number }).run);
  });

  it('two concurrent duplicates run the write once and both get its response', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const key = randomUUID();
    const before = runs;
    const send = () =>
      http
        .post('/v1/test-idempotency/writes')
        .set('Idempotency-Key', key)
        .send({ note: 'race', delayMs: 300 });

    const [one, two] = await Promise.all([send(), send()]);
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(one.body).toEqual(two.body);
    expect(runs).toBe(before + 1);
    expect([one, two].filter((res) => res.headers['idempotency-replayed'] === 'true')).toHaveLength(
      1,
    );
    expect(await t.prisma.idempotencyRecord.count({ where: { key } })).toBe(1);
  });

  it('a failed write is not stored, so a retry with the same key runs again', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const key = randomUUID();
    const send = (failWith?: string) =>
      http
        .post('/v1/test-idempotency/writes')
        .set('Idempotency-Key', key)
        .send({ note: 'retry', ...(failWith ? { failWith } : {}) });

    await send('boom').expect(500);
    expect(await t.prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    // A retry must repeat the same request; this one differs (no failWith),
    // which is fine because nothing was stored for the key.
    const retry = await send().expect(201);
    expect(retry.headers['idempotency-replayed']).toBeUndefined();
  });

  it('a duplicate waiting on a first request that then fails gets 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const key = randomUUID();
    const before = runs;
    const send = () =>
      http
        .post('/v1/test-idempotency/writes')
        .set('Idempotency-Key', key)
        .send({ note: 'doomed', delayMs: 300, failWith: 'boom' });

    const [one, two] = await Promise.all([send(), send()]);
    expect([one.status, two.status].sort()).toEqual([409, 500]);
    const waited = one.status === 409 ? one : two;
    expect(body(waited).code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(runs).toBe(before + 1);
  });

  it('stores and replays empty responses with their status (204)', async () => {
    const { http } = await loginAs(t, VOLUNTEER_A);
    const key = randomUUID();
    const before = runs;
    await http.post('/v1/test-idempotency/no-content').set('Idempotency-Key', key).expect(204);
    const replay = await http
      .post('/v1/test-idempotency/no-content')
      .set('Idempotency-Key', key)
      .expect(204);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(runs).toBe(before + 1);
  });

  it('keeps records for the configured time (7 days by default)', async () => {
    const record = await t.prisma.idempotencyRecord.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    const days = (record.expiresAt.getTime() - record.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 5);
  });

  it('still needs a signed-in user', async () => {
    await t
      .http()
      .post('/v1/test-idempotency/writes')
      .set('Idempotency-Key', randomUUID())
      .send({ note: 'x' })
      .expect(401);
  });
});
