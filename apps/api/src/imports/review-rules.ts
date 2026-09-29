import type { ImportRowStatus } from '../generated/prisma/client';
import type { ElectorCounts } from './extraction/contract';

/**
 * Review rules for extracted rows (#46): what an admin can correct, how a
 * row's messages and status follow its corrections, and the totals check.
 * Pure functions, so the service and the tests share them.
 */

/** Below this OCR confidence a field is flagged (the roll-parser's own threshold). */
export const LOW_CONFIDENCE = 0.6;

/** Fields an admin can correct; `sectionNumber` is the row's `section_no`. */
export const CORRECTABLE_FIELDS = [
  'epic',
  'name',
  'relationType',
  'relativeName',
  'houseNumber',
  'age',
  'gender',
  'marker',
  'sectionNumber',
] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export type RowValues = Record<string, unknown>;

export interface RowMessage {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** The field it is about (camelCase), or null for the whole row. */
  field: string | null;
  /** Set on messages added during review (rather than by extraction). */
  source?: 'review';
  /** An extraction message about a field an admin has since corrected. */
  resolved?: boolean;
}

/** Added when an admin rejects a row; it carries the reason. */
export const REJECTED_CODE = 'row.rejected';

/**
 * The field a message is about. Extraction writes paths such as
 * `rows[12].relation_type`; the review works with `relationType`.
 */
export function fieldOf(path: string | null | undefined): string | null {
  if (!path) return null;
  const last = path
    .split('.')
    .at(-1)!
    .replace(/\[\d+\]$/, '');
  if (last === 'serial') return 'printedSerial';
  if (last === 'section_number') return 'sectionNumber';
  return last.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Messages as stored, with the field name normalised. */
export function normaliseMessages(stored: unknown): RowMessage[] {
  if (!Array.isArray(stored)) return [];
  return (stored as (RowMessage & { field?: string | null })[]).map((m) => ({
    ...m,
    field: m.source === 'review' ? (m.field ?? null) : fieldOf(m.field),
  }));
}

/** The values a row will be confirmed with: extracted, then corrections on top. */
export function currentValues(
  extracted: RowValues,
  sectionNo: number | null,
  corrected: RowValues | null,
): RowValues {
  return { ...extracted, sectionNumber: sectionNo, ...(corrected ?? {}) };
}

/**
 * Re-runs the review checks: extraction messages about corrected fields are
 * marked resolved, review messages are replaced by `added`, and the reject
 * reason is kept (or dropped when the row is no longer rejected).
 */
export function revalidate(
  stored: RowMessage[],
  corrected: RowValues | null,
  rejected: { reason: string } | null,
  added: RowMessage[],
): RowMessage[] {
  const extraction = stored
    .filter((m) => m.source !== 'review')
    .map(({ resolved: _resolved, ...m }) =>
      m.field !== null && corrected && m.field in corrected ? { ...m, resolved: true } : m,
    );
  const rejection: RowMessage[] = rejected
    ? [
        {
          code: REJECTED_CODE,
          severity: 'info',
          message: rejected.reason,
          field: null,
          source: 'review',
        },
      ]
    : [];
  return [...extraction, ...added, ...rejection];
}

/** `rejected` if an admin rejected it, else `warning` while anything is unresolved. */
export function rowStatus(messages: RowMessage[]): ImportRowStatus {
  if (messages.some((m) => m.code === REJECTED_CODE && m.source === 'review')) return 'rejected';
  return messages.some((m) => !m.resolved) ? 'warning' : 'accepted';
}

/** Rows that will become active voters: not rejected, and not marked deleted on the roll. */
export function countVoters(
  rows: { status: ImportRowStatus; current: RowValues }[],
): ElectorCounts {
  const active = rows.filter((r) => r.status !== 'rejected' && r.current.marker !== 'deleted');
  const gender = (g: string) => active.filter((r) => r.current.gender === g).length;
  return {
    male: gender('male'),
    female: gender('female'),
    thirdGender: gender('third_gender'),
    total: active.length,
  };
}

const COUNT_KEYS: (keyof ElectorCounts)[] = ['male', 'female', 'thirdGender', 'total'];

/** Printed totals from `import_file.printed_totals` (`{ counts: {...} }`), if readable. */
export function printedCounts(printedTotals: unknown): ElectorCounts | null {
  const counts = (printedTotals as { counts?: Record<string, unknown> } | null)?.counts;
  if (!counts) return null;
  const { male, female, thirdGender, total } = counts;
  if (
    typeof male !== 'number' ||
    typeof female !== 'number' ||
    typeof thirdGender !== 'number' ||
    typeof total !== 'number'
  ) {
    return null;
  }
  return { male, female, thirdGender, total };
}

export interface TotalsCheck {
  printed: ElectorCounts | null;
  /** As extracted, before review. */
  extracted: ElectorCounts | null;
  /** After corrections and rejected rows. */
  current: ElectorCounts;
  /** current − printed, per count; null when the printed totals couldn't be read. */
  difference: ElectorCounts | null;
  matches: boolean;
}

export function totalsCheck(
  printed: ElectorCounts | null,
  extracted: ElectorCounts | null,
  current: ElectorCounts,
): TotalsCheck {
  const difference: ElectorCounts | null = printed
    ? {
        male: current.male - printed.male,
        female: current.female - printed.female,
        thirdGender: current.thirdGender - printed.thirdGender,
        total: current.total - printed.total,
      }
    : null;
  return {
    printed,
    extracted,
    current,
    difference,
    matches: difference !== null && COUNT_KEYS.every((k) => difference[k] === 0),
  };
}

/** A row still has an unresolved error (and isn't rejected). */
export function hasOpenError(status: ImportRowStatus, messages: RowMessage[]): boolean {
  return status !== 'rejected' && messages.some((m) => m.severity === 'error' && !m.resolved);
}
