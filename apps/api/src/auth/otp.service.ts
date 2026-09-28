import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';
import type { TokenPair } from './dto';
import { OTP_SENDER, type OtpSender } from './otp-sender';
import { TokenService } from './token.service';

// Redis keys. Codes are stored only as an HMAC, with the attempt count.
export const otpKey = (phone: string) => `otp:code:${phone}`;
export const otpRateKey = (phone: string) => `otp:rate:${phone}`;

// Counts one verification attempt, atomically and only while the code exists
// (HINCRBY on an expired key would recreate it without a TTL). Returns
// [hash, attempts], or nil when there is no code.
const COUNT_ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
return { redis.call('HGET', KEYS[1], 'hash'), attempts }
`;

const invalid = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.OTP_INVALID,
    'The code is wrong or has expired',
  );

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private setting<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  private hash(phone: string, code: string): string {
    // Keyed so that a copy of Redis can't be brute-forced offline (a 6-digit
    // code has only a million values). The prefix separates it from refresh
    // token hashes made with the same key.
    return createHmac('sha256', this.setting('JWT_REFRESH_SECRET'))
      .update(`otp:${phone}:${code}`)
      .digest('hex');
  }

  /**
   * Sends a code if the phone belongs to an active user. The caller always
   * answers 202, so the response never reveals whether a phone is registered.
   * The rate limit applies to every phone, known or not, for the same reason.
   */
  async request(phone: string): Promise<void> {
    const rateKey = otpRateKey(phone);
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, this.setting('OTP_REQUEST_WINDOW_SECONDS'));
    if (count > this.setting('OTP_REQUEST_LIMIT')) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'Too many code requests for this phone. Try again later.',
      );
    }

    const user = await this.prisma.appUser.findUnique({ where: { phone } });
    if (user?.status !== 'active') return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .del(otpKey(phone))
      .hset(otpKey(phone), { hash: this.hash(phone, code), attempts: 0 })
      .expire(otpKey(phone), this.setting('OTP_TTL_SECONDS'))
      .exec();
    await this.sender.send(phone, code);
  }

  /** Checks the code and, if right, starts a session for the device. */
  async verify(phone: string, code: string, deviceId: string): Promise<TokenPair> {
    const key = otpKey(phone);
    const counted = (await this.redis.eval(COUNT_ATTEMPT, 1, key)) as [string, number] | null;
    if (!counted) throw invalid();

    const [stored, attempts] = counted;
    const given = Buffer.from(this.hash(phone, code), 'hex');
    const matches = given.length === 32 && timingSafeEqual(given, Buffer.from(stored, 'hex'));
    const maxAttempts = this.setting('OTP_MAX_ATTEMPTS');

    if (!matches || attempts > maxAttempts) {
      if (attempts >= maxAttempts) {
        await this.redis.del(key);
        throw new AppException(
          HttpStatus.UNAUTHORIZED,
          ErrorCode.OTP_LOCKED,
          'Too many wrong codes. Request a new code.',
        );
      }
      throw invalid();
    }

    // Single use: only the request that deletes the code may sign in.
    if ((await this.redis.del(key)) !== 1) throw invalid();

    const user = await this.prisma.appUser.findUnique({ where: { phone } });
    if (user?.status !== 'active') throw invalid();

    const tokens = await this.tokens.startSession(user.id, deviceId);
    await this.prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return tokens;
  }
}
