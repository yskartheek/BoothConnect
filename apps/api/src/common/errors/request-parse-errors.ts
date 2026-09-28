import { HttpStatus, type INestApplication } from '@nestjs/common';
import type { AbstractHttpAdapter } from '@nestjs/core';

import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';

/**
 * Nest turns body-parser's SyntaxError (invalid JSON) and Express's URIError
 * (bad %-encoding in the path) into a BadRequestException that carries the
 * original message. Node's JSON.parse messages quote part of the body, which
 * may be personal data, so map both to fixed messages instead.
 */
export function mapRequestParseErrors(app: INestApplication): void {
  const adapter = app.getHttpAdapter() as AbstractHttpAdapter;
  const original = adapter.mapException.bind(adapter);
  adapter.mapException = (error: unknown): unknown => {
    if (error instanceof SyntaxError) {
      return new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MALFORMED_JSON,
        'The request body is not valid JSON',
      );
    }
    if (error instanceof URIError) {
      return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, 'Malformed URL');
    }
    return original(error);
  };
}
