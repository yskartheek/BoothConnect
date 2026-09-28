import { HttpException } from '@nestjs/common';

import type { ErrorCode } from './error-codes';

/** The body of every error response. */
export interface ApiErrorBody {
  requestId: string;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Throw this for an error the client should act on: it becomes
 * `{ requestId, code, message, details }` with the given status. `message`
 * and `details` are sent to the client, so they must not contain secrets or
 * another person's data.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
