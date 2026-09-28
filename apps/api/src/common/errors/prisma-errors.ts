import { HttpStatus } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';

interface AdapterCause {
  constraint?: { fields?: unknown; index?: unknown };
}

// Prisma's own engine names the columns in meta.target. Through the pg driver
// adapter, meta.driverAdapterError.cause.constraint has the columns or, for
// unique violations, only the index name (e.g. "app_user_phone_key").
function uniqueDetails(meta: Record<string, unknown> | undefined): unknown {
  const target = meta?.target;
  if (Array.isArray(target)) return { fields: target.map(String) };
  if (typeof target === 'string') return { fields: [target] };
  const constraint = (meta?.driverAdapterError as { cause?: AdapterCause } | undefined)?.cause
    ?.constraint;
  if (Array.isArray(constraint?.fields)) return { fields: constraint.fields.map(String) };
  if (typeof constraint?.index === 'string') return { constraint: constraint.index };
  return undefined;
}

/**
 * Maps the Prisma errors a client can cause to stable codes. Returns
 * undefined for everything else, which the filter treats as a 500.
 */
export function mapPrismaError(error: unknown): AppException | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = error.meta;
  switch (error.code) {
    case 'P2002':
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.UNIQUE_VIOLATION,
        'A record with the same unique value already exists',
        uniqueDetails(meta),
      );
    case 'P2003':
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.FOREIGN_KEY_VIOLATION,
        'The record refers to, or is referred to by, another record',
      );
    case 'P2025':
      return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Record not found');
    default:
      return undefined;
  }
}
