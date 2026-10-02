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
// A voter's code is bound to the EPIC as well as the phone (#223).
export const voterOtpKey = (epic: string, phone: string) => `otp:voter:${epic}:${phone}`;
export const epicRateKey = (epic: string) => `otp:rate:epic:${epic}`;

/** EPIC numbers are compared without spaces, upper-case. */
export const normaliseEpic = (epic: string) => epic.replace(/\s+/g, '').toUpperCase();

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

  private hash(subject: string, code: string): string {
    // Keyed so that a copy of Redis can't be brute-forced offline (a 6-digit
    // code has only a million values). The "otp:" prefix of every subject
    // separates it from refresh token hashes made with the same key.
    return createHmac('sha256', this.setting('JWT_REFRESH_SECRET'))
      .update(`${subject}:${code}`)
      .digest('hex');
  }

  /**
   * Sends a code if the phone belongs to an active user. The caller always
   * answers 202, so the response never reveals whether a phone is registered.
   * The rate limit applies to every phone, known or not, for the same reason.
   */
  async request(phone: string): Promise<void> {
    await this.limit(otpRateKey(phone), 'Too many code requests for this phone. Try again later.');

    const user = await this.prisma.appUser.findUnique({ where: { phone } });
    if (user?.status !== 'active') return;
    await this.issue(otpKey(phone), `otp:${phone}`, phone);
  }

  /** Checks the code and, if right, starts a session for the device. */
  async verify(
    phone: string,
    code: string,
    deviceId: string,
  ): Promise<{ userId: string; sessionId: string; tokens: TokenPair }> {
    await this.check(otpKey(phone), `otp:${phone}`, code);

    const user = await this.prisma.appUser.findUnique({ where: { phone } });
    if (user?.status !== 'active') throw invalid();

    const { sessionId, tokens } = await this.tokens.startSession(user.id, deviceId);
    await this.prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { userId: user.id, sessionId, tokens };
  }

  /**
   * A voter's sign-in (#223): sends a code to `phone` only if an active voter
   * has this EPIC and `phone` is their current mobile number. As for staff,
   * the caller always answers 202, and both the phone and the EPIC are rate
   * limited whether or not they match, so nothing can be learned about who is
   * on the roll.
   */
  async requestVoter(epicNumber: string, phone: string): Promise<void> {
    const epic = normaliseEpic(epicNumber);
    const message = 'Too many code requests. Try again later.';
    await this.limit(otpRateKey(phone), message);
    await this.limit(epicRateKey(epic), message);

    if (!(await this.voterFor(epic, phone))) return;
    await this.issue(voterOtpKey(epic, phone), `otp:voter:${epic}:${phone}`, phone);
  }

  /**
   * Checks a voter's code and starts a voter session for the device. The
   * first sign-in creates the phone's user if it has none (no role
   * assignment: a voter's session gets its rights from the voter record).
   * Every failure is the same `OTP_INVALID`.
   */
  async verifyVoter(
    epicNumber: string,
    phone: string,
    code: string,
    deviceId: string,
  ): Promise<{ userId: string; sessionId: string; voterId: string; tokens: TokenPair }> {
    const epic = normaliseEpic(epicNumber);
    await this.check(voterOtpKey(epic, phone), `otp:voter:${epic}:${phone}`, code);

    // Checked again: the mobile number may have changed since the code was sent.
    const voter = await this.voterFor(epic, phone);
    if (!voter) throw invalid();

    const existing = await this.prisma.appUser.findUnique({ where: { phone } });
    if (existing && existing.status !== 'active') throw invalid();
    const user =
      existing ??
      (await this.prisma.appUser.create({
        data: { organizationId: voter.organizationId, name: voter.name, phone },
      }));

    const { sessionId, tokens } = await this.tokens.startSession(user.id, deviceId, voter.id);
    await this.prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { userId: user.id, sessionId, voterId: voter.id, tokens };
  }

  /**
   * The active voter with this EPIC whose current mobile number is `phone`,
   * if exactly one; else null.
   */
  private async voterFor(
    epic: string,
    phone: string,
  ): Promise<{ id: string; organizationId: string; name: string } | null> {
    const rows = await this.prisma.$queryRaw<
      { id: string; organizationId: string; name: string | null }[]
    >`
      SELECT v.id, p.organization_id AS "organizationId",
             COALESCE(
               (SELECT n.value #>> '{}' FROM field_value n
                  JOIN field_definition nd ON nd.id = n.field_definition_id AND nd.key = 'name'
                 WHERE n.entity_type = 'voter' AND n.entity_id = v.id AND n.is_current
                 ORDER BY n.collected_at DESC LIMIT 1),
               v.source_data ->> 'name') AS name
        FROM voter v
        JOIN election_program p ON p.id = v.program_id
       WHERE upper(replace(v.source_voter_id, ' ', '')) = ${epic}
         AND v.record_status = 'active'
         AND EXISTS (
           SELECT 1 FROM field_value m
             JOIN field_definition md ON md.id = m.field_definition_id AND md.key = 'mobile_number'
            WHERE m.entity_type = 'voter' AND m.entity_id = v.id AND m.is_current
              AND m.value #>> '{}' = ${phone})`;
    if (rows.length !== 1) return null;
    const [row] = rows;
    return { id: row!.id, organizationId: row!.organizationId, name: row!.name ?? epic };
  }

  /** Counts a request against `key`'s window; over the limit, 429. */
  private async limit(key: string, message: string): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, this.setting('OTP_REQUEST_WINDOW_SECONDS'));
    if (count > this.setting('OTP_REQUEST_LIMIT')) {
      throw new AppException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED, message);
    }
  }

  /** Stores a new code under `key` (replacing any earlier one) and sends it. */
  private async issue(key: string, subject: string, phone: string): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .del(key)
      .hset(key, { hash: this.hash(subject, code), attempts: 0 })
      .expire(key, this.setting('OTP_TTL_SECONDS'))
      .exec();
    await this.sender.send(phone, code);
  }

  /** Checks a code against `key`, once; throws OTP_INVALID or OTP_LOCKED. */
  private async check(key: string, subject: string, code: string): Promise<void> {
    const counted = (await this.redis.eval(COUNT_ATTEMPT, 1, key)) as [string, number] | null;
    if (!counted) throw invalid();

    const [stored, attempts] = counted;
    const given = Buffer.from(this.hash(subject, code), 'hex');
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
  }
}
