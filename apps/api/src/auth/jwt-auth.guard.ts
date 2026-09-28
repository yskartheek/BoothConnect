import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { type AuthenticatedRequest, IS_PUBLIC } from './decorators';
import { TokenService } from './token.service';

export const unauthenticated = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    'Sign in again: the access token is missing, invalid or expired',
  );

/**
 * Registered globally: every route needs `Authorization: Bearer <access token>`
 * unless it is marked @Public(). The token must be valid and its session
 * still open (not logged out, revoked or expired).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthenticated();

    const user = await this.tokens.authenticate(token);
    if (!user) throw unauthenticated();
    req.user = user;
    return true;
  }
}
