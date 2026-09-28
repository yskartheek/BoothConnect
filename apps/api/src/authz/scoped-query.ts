import { HttpStatus } from '@nestjs/common';

import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { Scope } from './scope.service';

/**
 * The only way booth-level data (households, voters, visits…) may be queried:
 * spread into every `where`, e.g.
 * `prisma.household.findMany({ where: { ...inScope(scope), … } })`.
 * With an empty scope it matches nothing.
 */
export function inScope(
  scope: Scope,
  field = 'pollingStationId',
): Record<string, { in: string[] }> {
  return { [field]: { in: scope.boothIds } };
}

/**
 * A record outside the caller's scope is reported exactly like one that
 * doesn't exist (404, never 403), so IDs can't be probed for existence.
 */
export function notFound(what = 'Record'): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found`);
}

/** Returns the record, or throws 404 when the scoped lookup found nothing. */
export function foundInScope<T>(record: T | null | undefined, what?: string): T {
  if (record === null || record === undefined) throw notFound(what);
  return record;
}
