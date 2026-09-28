import type { Request } from 'express';

import type { AuthUser } from '../auth/decorators';

/** Who made a change, for audit events recorded in the same transaction. */
export interface Actor {
  userId: string;
  sessionId?: string | null;
  requestId?: string | null;
}

export const actorOf = (user: AuthUser, req: Request & { id?: unknown }): Actor => ({
  userId: user.userId,
  sessionId: user.sessionId,
  requestId: typeof req.id === 'string' ? req.id : null,
});
