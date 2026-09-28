import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:isPublic';

/**
 * Marks a route (or a whole controller) as reachable without an access token.
 * Every other route requires one (JwtAuthGuard is global).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Who is calling: set on the request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  sessionId: string;
}

export type AuthenticatedRequest = { user?: AuthUser };

/** Injects the signed-in caller: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new Error('@CurrentUser() used on a @Public() route');
    return user;
  },
);
