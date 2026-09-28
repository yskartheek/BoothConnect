import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { type AuthenticatedRequest, IS_PUBLIC } from '../auth/decorators';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { Role } from '../generated/prisma/client';
import { ROLES, type ScopedRequest } from './decorators';
import { ScopeService } from './scope.service';

/**
 * Registered globally, after JwtAuthGuard: resolves the signed-in caller's
 * scope (roles and permitted booths) onto `req.scope`, and enforces @Roles().
 * A missing role is 403; data outside the scope is 404 (see scoped-query.ts).
 */
@Injectable()
export class GeoScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scopes: ScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest & ScopedRequest>();
    // JwtAuthGuard runs first and has already refused unauthenticated calls.
    if (!req.user) return false;
    req.scope = await this.scopes.resolve(req.user.userId);

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (required?.length && !required.some((role) => req.scope?.roles.includes(role))) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Your role does not allow this action',
      );
    }
    return true;
  }
}
