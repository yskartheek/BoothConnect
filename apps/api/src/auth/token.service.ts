import { createHmac, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import type { TokenPair } from './dto';

/** Claims in an access token: the user and the session (device) it belongs to. */
export interface AccessClaims {
  sub: string;
  sid: string;
}

/**
 * Issues tokens for a new session. #30 adds refresh rotation, logout and the
 * guard that checks access tokens on every request.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The value stored in `session.refresh_hash` (the token itself is never stored). */
  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET', { infer: true }))
      .update(`refresh:${token}`)
      .digest('hex');
  }

  /** Creates a session for the device and returns its first token pair. */
  async startSession(userId: string, deviceId: string): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshTtl = this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true });
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        refreshHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        lastUsedAt: new Date(),
      },
    });
    return { ...(await this.accessToken(userId, session.id)), refreshToken };
  }

  private async accessToken(
    userId: string,
    sessionId: string,
  ): Promise<Omit<TokenPair, 'refreshToken'>> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const claims: AccessClaims = { sub: userId, sid: sessionId };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn,
      algorithm: 'HS256',
    });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }
}
