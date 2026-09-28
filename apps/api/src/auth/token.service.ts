import { createHmac, randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';

import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';
import type { AuthUser } from './decorators';
import type { TokenPair } from './dto';

/** Claims in an access token: the user and the session (device) it belongs to. */
export interface AccessClaims {
  sub: string;
  sid: string;
}

// Hashes of refresh tokens that were rotated away, mapped to their session.
// Seeing one again means the token was copied: the whole session is revoked.
export const retiredRefreshKey = (hash: string) => `refresh:retired:${hash}`;

const invalidRefresh = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    'The refresh token is invalid or has expired. Sign in again.',
  );

/**
 * Sessions and their tokens: a short-lived access JWT, and an opaque refresh
 * token that rotates on every use. Only an HMAC of the current refresh token
 * is stored (`session.refresh_hash`); rotated-away hashes are remembered in
 * Redis until they would have expired, so a replayed old token is detected.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private setting<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** The value stored in `session.refresh_hash` (the token itself is never stored). */
  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.setting('JWT_REFRESH_SECRET'))
      .update(`refresh:${token}`)
      .digest('hex');
  }

  /** Creates a session for the device and returns its first token pair. */
  async startSession(userId: string, deviceId: string): Promise<TokenPair> {
    const refreshToken = newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        refreshHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.setting('JWT_REFRESH_TTL_SECONDS') * 1000),
        lastUsedAt: new Date(),
      },
    });
    return { ...(await this.accessToken(userId, session.id)), refreshToken };
  }

  /**
   * Exchanges a refresh token for a new pair. The old refresh token stops
   * working. Presenting an already-rotated token revokes the whole session:
   * either it was stolen, or the thief already used it.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const oldHash = this.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshHash: oldHash } });

    if (!session) {
      const reusedSessionId = await this.redis.get(retiredRefreshKey(oldHash));
      if (reusedSessionId) await this.revoke(reusedSessionId);
      throw invalidRefresh();
    }
    if (session.revokedAt || session.expiresAt <= new Date()) throw invalidRefresh();

    const next = newRefreshToken();
    // Conditional on the old hash, so of two concurrent refreshes with the same
    // token only one wins; the other is treated as a replay.
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshHash: oldHash, revokedAt: null },
      data: { refreshHash: this.hashRefreshToken(next), lastUsedAt: new Date() },
    });
    if (rotated.count !== 1) {
      await this.revoke(session.id);
      throw invalidRefresh();
    }

    const remainingSeconds = Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000);
    await this.redis.set(
      retiredRefreshKey(oldHash),
      session.id,
      'EX',
      Math.max(remainingSeconds, 1),
    );
    return { ...(await this.accessToken(session.userId, session.id)), refreshToken: next };
  }

  /** Ends a session: its refresh token and every access token for it stop working. */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Checks an access token: signature, expiry, and that its session is still
   * open. Returns undefined for anything that isn't a valid signed-in caller.
   */
  async authenticate(accessToken: string): Promise<AuthUser | undefined> {
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(accessToken, {
        secret: this.setting('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      return undefined;
    }
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return undefined;

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.userId !== claims.sub) return undefined;
    if (session.revokedAt || session.expiresAt <= new Date()) return undefined;
    return { userId: claims.sub, sessionId: claims.sid };
  }

  private async accessToken(
    userId: string,
    sessionId: string,
  ): Promise<Omit<TokenPair, 'refreshToken'>> {
    const expiresIn = this.setting('JWT_ACCESS_TTL_SECONDS');
    const claims: AccessClaims = { sub: userId, sid: sessionId };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.setting('JWT_ACCESS_SECRET'),
      expiresIn,
      algorithm: 'HS256',
    });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
