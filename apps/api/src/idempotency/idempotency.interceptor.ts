import { randomUUID } from 'node:crypto';

import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { from, lastValueFrom, type Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/decorators';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';
import { requestHash } from './request-hash';

export const IDEMPOTENT = 'idempotency:required';
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const REPLAYED_HEADER = 'Idempotency-Replayed';

/**
 * Marks a write that clients must send with an `Idempotency-Key` header (a
 * UUID per logical operation, reused for every retry of it). A retry gets the
 * first response back instead of the write being applied twice.
 */
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        'A unique key per logical request (8–128 of A–Z a–z 0–9 _ -). Retrying with the same key returns the first response instead of repeating the change.',
    }),
  );

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;
const LOCK_TTL_MS = 30_000;
const WAIT_FOR_FIRST_MS = 5_000;
const POLL_MS = 100;

export const idempotencyLockKey = (userId: string, key: string) =>
  `idempotency:lock:${userId}:${key}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Global interceptor behind @Idempotent(). Completed responses are stored in
 * `idempotency_record` (unique per user and key). While the first request is
 * still running, a Redis lock makes duplicates wait for its result instead of
 * running the write again.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean | undefined>(IDEMPOTENT, context.getHandler())) {
      return next.handle();
    }
    return from(this.handle(context, next));
  }

  private async handle(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & AuthenticatedRequest>();
    const res = http.getResponse<Response>();

    const key = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (typeof key !== 'string' || !KEY_FORMAT.test(key)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'This request needs an Idempotency-Key header: 8–128 letters, digits, "-" or "_" (a UUID works)',
      );
    }
    // @Idempotent() routes are never @Public(), so JwtAuthGuard has set req.user.
    const userId = req.user!.userId;
    const hash = requestHash(req.method, req.originalUrl ?? req.url, req.body);

    const stored = await this.stored(userId, key, hash, res);
    if (stored.found) return stored.body;

    const lockKey = idempotencyLockKey(userId, key);
    const lockToken = randomUUID();
    const locked = await this.redis.set(lockKey, lockToken, 'PX', LOCK_TTL_MS, 'NX');
    if (locked !== 'OK') return this.waitForFirst(userId, key, hash, res);

    try {
      // A request that finished just before we took the lock.
      const again = await this.stored(userId, key, hash, res);
      if (again.found) return again.body;

      const body: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.save(userId, key, hash, this.statusCode(context, req), body);
      return body;
    } finally {
      // Release only our own lock (it may have expired and been taken over).
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  /** The stored response for this key, if any; a different request under the key is a 422. */
  private async stored(
    userId: string,
    key: string,
    hash: string,
    res: Response,
  ): Promise<{ found: false } | { found: true; body: unknown }> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key: { userId, key } },
    });
    if (!record || record.expiresAt <= new Date()) return { found: false };
    if (record.requestHash !== hash) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was already used for a different request',
      );
    }
    res.status(record.statusCode).setHeader(REPLAYED_HEADER, 'true');
    return { found: true, body: (record.response as { body?: unknown }).body ?? undefined };
  }

  /** Another request with this key is running: wait for its result, briefly. */
  private async waitForFirst(
    userId: string,
    key: string,
    hash: string,
    res: Response,
  ): Promise<unknown> {
    for (let waited = 0; waited < WAIT_FOR_FIRST_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      const stored = await this.stored(userId, key, hash, res);
      if (stored.found) return stored.body;
      if ((await this.redis.exists(idempotencyLockKey(userId, key))) === 0) {
        // The first request may have stored its response and released the
        // lock between the two checks above: look once more before giving up.
        const last = await this.stored(userId, key, hash, res);
        if (last.found) return last.body;
        break;
      }
    }
    // The first request failed (nothing stored) or is still running.
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.IDEMPOTENCY_IN_PROGRESS,
      'A request with this Idempotency-Key is still being processed or failed. Retry shortly.',
    );
  }

  /** Stores a successful response. Failures aren't stored, so a retry can succeed. */
  private async save(
    userId: string,
    key: string,
    hash: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const ttl = this.config.get('IDEMPOTENCY_TTL_SECONDS', { infer: true });
    const now = new Date();
    // An expired record for the same key is replaced.
    await this.prisma.idempotencyRecord.deleteMany({
      where: { userId, key, expiresAt: { lte: now } },
    });
    await this.prisma.idempotencyRecord.create({
      data: {
        userId,
        key,
        requestHash: hash,
        statusCode,
        // Wrapped, so an empty (204) response is stored as { body: null }.
        response: { body: body ?? null },
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttl * 1000),
      },
    });
  }

  /** The status the route answers with: @HttpCode(), else Nest's default. */
  private statusCode(context: ExecutionContext, req: Request): number {
    const explicit = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );
    return explicit ?? (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
  }
}
