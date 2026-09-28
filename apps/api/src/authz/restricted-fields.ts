import type { Role } from '../generated/prisma/client';
import type { Scope } from './scope.service';

/**
 * Roles that may see and write restricted fields (caste/community): the
 * volunteers who collect them with the voter's consent, and admins who
 * correct them (ADR 0003). Campaign managers see restricted data only as
 * thresholded aggregates in analytics.
 */
export const RESTRICTED_FIELD_ROLES: readonly Role[] = ['admin', 'volunteer'];

export const seesRestricted = (scope: Scope): boolean =>
  scope.roles.some((role) => RESTRICTED_FIELD_ROLES.includes(role));
