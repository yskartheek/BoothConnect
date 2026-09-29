import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiExtension, ApiProduces, ApiResponse } from '@nestjs/swagger';

/**
 * Names the TypeScript type a route returns, for the OpenAPI spec (#52).
 * `type` is an exported interface or type alias (generic responses have an
 * alias in `responses.ts`); `pnpm --filter api openapi` turns it into a JSON
 * schema. The export fails for a route without one.
 */
export const ApiResult = (type: string, status: number = HttpStatus.OK) =>
  applyDecorators(
    ApiExtension('x-result-type', type),
    ApiResponse({ status, schema: { $ref: `#/components/schemas/${type}` } }),
  );

/** A route that answers with no body. */
export const ApiNoBody = (status: number = HttpStatus.NO_CONTENT) =>
  applyDecorators(
    ApiExtension('x-result-type', null),
    ApiResponse({ status, description: 'No content' }),
  );

/** A route that streams a file of this media type. */
export const ApiFile = (contentType: string) =>
  applyDecorators(
    ApiExtension('x-result-type', null),
    ApiProduces(contentType),
    ApiResponse({
      status: HttpStatus.OK,
      content: { [contentType]: { schema: { type: 'string', format: 'binary' } } },
    }),
  );
