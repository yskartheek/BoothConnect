import type { Schemas } from '@boothconnect/api-client';

import type { MessageKey } from '@/lib/i18n';

export type UserSummary = Schemas['UserSummary'];
export type RoleAssignment = Schemas['RoleAssignmentView'];
export type Role = Schemas['Role'];
export type GrantableRole = Schemas['CreateUserDto']['role'];

/** The roles an admin can give, in the order they are offered. */
export const GRANTABLE_ROLES: GrantableRole[] = ['volunteer', 'campaign_manager', 'admin'];

export const ROLE: Record<Role, MessageKey> = {
  admin: 'users.roleAdmin',
  campaign_manager: 'users.roleCampaignManager',
  volunteer: 'users.roleVolunteer',
  voter: 'users.roleVoter',
};

export type AssignmentStatus = 'active' | 'ended' | 'upcoming';

/** Active now; ended (its end has passed); or not started yet. */
export function statusOf(assignment: RoleAssignment, now = new Date()): AssignmentStatus {
  if (assignment.active) return 'active';
  return assignment.validUntil && new Date(assignment.validUntil) <= now ? 'ended' : 'upcoming';
}

export const STATUS: Record<AssignmentStatus, MessageKey> = {
  active: 'users.statusActive',
  ended: 'users.statusEnded',
  upcoming: 'users.statusUpcoming',
};

const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

/** A date picked in a date input (YYYY-MM-DD), as the start of that day here; empty: none. */
export const startOfDay = (date: string): string | undefined =>
  date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
