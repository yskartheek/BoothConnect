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

  /**
   * Creates a session for the device and returns its ID and first token pair.
   * With `voterId`, it's a voter's session: it acts for that voter record only.
   */
  async startSession(
    userId: string,
    deviceId: string,
    voterId?: string,
  ): Promise<{ sessionId: string; tokens: TokenPair }> {
    const refreshToken = newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        voterId: voterId ?? null,
        refreshHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.setting('JWT_REFRESH_TTL_SECONDS') * 1000),
        lastUsedAt: new Date(),
      },
    });
    const tokens = { ...(await this.accessToken(userId, session.id)), refreshToken };
    return { sessionId: session.id, tokens };
  }

  /**
   * Exchanges a refresh token for a new pair. The old refresh token stops
   * working. Presenting an already-rotated token revokes the whole session:
   * either it was stolen, or the thief already used it.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const oldHash = this.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshHash: oldHash },
      include: { user: { select: { status: true } } },
    });

    if (!session) {
      const reusedSessionId = await this.redis.get(retiredRefreshKey(oldHash));
      if (reusedSessionId) await this.revoke(reusedSessionId);
      throw invalidRefresh();
    }
    // A suspended user can't get new tokens either. The session stays open,
    // so reactivating the user restores the device without a new sign-in.
    if (!isOpen(session) || session.user.status !== 'active') throw invalidRefresh();

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
   * Checks an access token: signature, expiry, that its session is still open
   * and that the user is active. Returns undefined for anything that isn't a
   * valid signed-in caller.
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

    // Checked on every request, not cached, so logging out, revoking a
    // session or suspending a user takes effect on the very next request
    // (spec §7.1), not when the access token expires.
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: {
        userId: true,
        voterId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { status: true } },
      },
    });
    if (!session || session.userId !== claims.sub) return undefined;
    if (!isOpen(session) || session.user.status !== 'active') return undefined;
    return {
      userId: claims.sub,
      sessionId: claims.sid,
      ...(session.voterId ? { voterId: session.voterId } : {}),
    };
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

function isOpen(session: { revokedAt: Date | null; expiresAt: Date }): boolean {
  return !session.revokedAt && session.expiresAt > new Date();
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
