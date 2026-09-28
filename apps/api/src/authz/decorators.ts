import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

import type { Role } from '../generated/prisma/client';
import type { Scope } from './scope.service';

export const ROLES = 'authz:roles';

/**
 * Restricts a route (or controller) to callers holding at least one of these
 * roles in an active assignment. Without it, any signed-in user may call the
 * route; the data they see is still limited to their scope.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export type ScopedRequest = { scope?: Scope };

/** Injects the caller's scope: `@CurrentScope() scope: Scope`. */
export const CurrentScope = createParamDecorator((_data: unknown, ctx: ExecutionContext): Scope => {
  const scope = ctx.switchToHttp().getRequest<ScopedRequest>().scope;
  if (!scope) throw new Error('@CurrentScope() used on a @Public() route');
  return scope;
});
