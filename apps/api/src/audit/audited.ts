import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/decorators';
import { toApiError } from '../common/errors/all-exceptions.filter';
import { AuditService } from './audit.service';

export interface AuditedOptions {
  action: string;
  resourceType: string;
  /**
   * Which record the action touched. Defaults to the `:id` route parameter,
   * then the `id` of the response body.
   */
  resourceId?: (req: Request & AuthenticatedRequest, response?: unknown) => string | undefined;
}

export const AUDITED = 'audit:audited';

/**
 * Records one audit event per call of the route: `success` when it returns,
 * `failure` (with the error code) when it throws; the error is re-thrown.
 */
export const Audited = (options: AuditedOptions) => SetMetadata(AUDITED, options);

function defaultResourceId(req: Request, response?: unknown): string | undefined {
  const param = req.params?.id;
  if (typeof param === 'string') return param;
  const id = (response as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' ? id : undefined;
}

/** Global interceptor behind @Audited(). Routes without it pass straight through. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(AUDITED, context.getHandler());
    if (!options) return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<Request & AuthenticatedRequest & { id?: unknown }>();
    const entry = (result: 'success' | 'failure', response?: unknown) => ({
      action: options.action,
      resourceType: options.resourceType,
      resourceId: (options.resourceId ?? defaultResourceId)(req, response) ?? null,
      result,
      actorId: req.user?.userId,
      sessionId: req.user?.sessionId,
      requestId: typeof req.id === 'string' ? req.id : null,
    });

    return next.handle().pipe(
      mergeMap((response: unknown) =>
        from(this.audit.record(entry('success', response)).then((): unknown => response)),
      ),
      catchError((error: unknown) =>
        from(
          this.audit.record({
            ...entry('failure'),
            metadata: { reason: toApiError(error).code },
          }),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }
}
