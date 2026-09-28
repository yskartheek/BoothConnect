import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { resolveRequestId } from '../../config/logger';
import { type ApiErrorBody, AppException } from './app.exception';
import { codeForStatus, ErrorCode } from './error-codes';
import { mapPrismaError } from './prisma-errors';

type ApiError = Omit<ApiErrorBody, 'requestId'> & { status: number };

const INTERNAL: ApiError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Something went wrong. Quote the request ID if you report it.',
};

/** Turns anything thrown into the API's error shape, without internals. */
export function toApiError(exception: unknown): ApiError {
  if (exception instanceof AppException) {
    const { code, message, details } = exception;
    return { status: exception.getStatus(), code, message, details };
  }

  const prisma = mapPrismaError(exception);
  if (prisma) return toApiError(prisma);

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return { ...INTERNAL, status, code: codeForStatus(status) };
    return { status, code: codeForStatus(status), message: exception.message };
  }

  return INTERNAL;
}

/**
 * Every error response is `{ requestId, code, message, details? }`, with the
 * same request ID as the `X-Request-Id` header and the log lines. Stack traces
 * and error internals only go to the log, and only for 5xx errors.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: unknown }>();
    const res = http.getResponse<Response>();
    // Requests rejected before the logging middleware ran (e.g. invalid JSON)
    // have no ID yet; give them one by the same rules, header included.
    const requestId = typeof req.id === 'string' ? req.id : resolveRequestId(req, res);
    const { status, ...error } = toApiError(exception);

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId },
        exception instanceof Error ? exception.message : 'Non-error thrown',
      );
    }
    if (res.headersSent) return;

    const body: ApiErrorBody = { requestId, ...error };
    if (body.details === undefined) delete body.details;
    res.status(status).json(body);
  }
}
