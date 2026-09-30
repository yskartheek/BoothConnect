// Shared by the audit page (server) and the explorer (client): no 'use client'.

/** The filters, as kept in the address (`/audit?action=import.*&from=2026-09-01`). */
export interface AuditFilters {
  actor?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  result?: string;
  /** Dates (YYYY-MM-DD), inclusive. */
  from?: string;
  to?: string;
}

export const FILTER_KEYS = [
  'actor',
  'action',
  'resourceType',
  'resourceId',
  'result',
  'from',
  'to',
] as const;

/** The filters as a query string, empty ones left out. */
export function filtersToSearch(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

const startOf = (date: string) => new Date(`${date}T00:00:00`);

/**
 * The API's query: the "to" date is inclusive here, so the API gets the
 * start of the next day (its `to` is exclusive).
 */
export function apiQuery(filters: AuditFilters) {
  const next = (date: string) => {
    const day = startOf(date);
    day.setDate(day.getDate() + 1);
    return day.toISOString();
  };
  return {
    ...(filters.actor ? { actorId: filters.actor } : {}),
    ...(filters.action ? { action: filters.action.trim() } : {}),
    ...(filters.resourceType ? { resourceType: filters.resourceType.trim() } : {}),
    ...(filters.resourceId ? { resourceId: filters.resourceId.trim() } : {}),
    ...(filters.result ? { result: filters.result as 'success' | 'failure' | 'denied' } : {}),
    ...(filters.from ? { from: startOf(filters.from).toISOString() } : {}),
    ...(filters.to ? { to: next(filters.to) } : {}),
  };
}
