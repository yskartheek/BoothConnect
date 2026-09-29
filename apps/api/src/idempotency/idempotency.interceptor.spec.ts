import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { IDEMPOTENCY_KEY_HEADER, IdempotencyInterceptor } from './idempotency.interceptor';
import { requestHash } from './request-hash';

/**
 * A duplicate that arrives while the first request is running waits for its
 * result (#179). These fakes replay one order of events exactly.
 */
describe('IdempotencyInterceptor: waiting for the first request', () => {
  const key = 'key-12345678';
  const req = {
    method: 'POST',
    originalUrl: '/v1/visits',
    url: '/v1/visits',
    body: { a: 1 },
    headers: { [IDEMPOTENCY_KEY_HEADER]: key },
    user: { userId: 'user-1' },
  };
  const record = {
    requestHash: requestHash('POST', '/v1/visits', { a: 1 }),
    statusCode: 201,
    response: { body: { id: 'visit-1' } },
    expiresAt: new Date(Date.now() + 60_000),
  };

  function setUp(events: { stored: boolean[]; lockHeld: boolean[] }) {
    const findUnique = jest.fn(() => Promise.resolve(events.stored.shift() ? record : null));
    const redis = {
      // Another request holds the lock.
      set: jest.fn(() => Promise.resolve(null)),
      exists: jest.fn(() => Promise.resolve(events.lockHeld.shift() ? 1 : 0)),
    };
    const interceptor = new IdempotencyInterceptor(
      { get: () => true } as never,
      { idempotencyRecord: { findUnique } } as never,
      { get: () => 86_400 } as never,
      redis as never,
    );
    const res = { status: jest.fn().mockReturnThis(), setHeader: jest.fn().mockReturnThis() };
    const context = {
      getHandler: () => undefined,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    const handler = jest.fn(() => of({ ran: true }));
    const run = () =>
      lastValueFrom(interceptor.intercept(context, { handle: handler } as CallHandler));
    return { run, res, handler, findUnique };
  }

  it('returns the stored response when it lands between the two checks', async () => {
    // Before the lock: nothing stored. Poll: still nothing stored, then the
    // first request saves and releases its lock; the lock is gone.
    const { run, res, handler } = setUp({ stored: [false, false, true], lockHeld: [false] });
    await expect(run()).resolves.toEqual({ id: 'visit-1' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith('Idempotency-Replayed', 'true');
    expect(handler).not.toHaveBeenCalled();
  });

  it('still answers 409 when the first request stored nothing (it failed)', async () => {
    const { run, handler } = setUp({ stored: [false, false, false], lockHeld: [false] });
    await expect(run()).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps waiting while the lock is held', async () => {
    const { run, findUnique } = setUp({
      stored: [false, false, false, true],
      lockHeld: [true],
    });
    await expect(run()).resolves.toEqual({ id: 'visit-1' });
    expect(findUnique).toHaveBeenCalledTimes(4);
  });
});
