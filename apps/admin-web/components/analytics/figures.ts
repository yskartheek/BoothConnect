import type { Schemas } from '@boothconnect/api-client';

import { type MessageKey, t } from '@/lib/i18n';

/** A figure from the analytics API: a number, "suppressed" (a small group), or null (not collected). */
export type Figure = number | 'suppressed' | null;
export type Figures = Record<string, Figure>;
export type Summary = Schemas['AnalyticsSummary'];
export type Breakdown = Schemas['ChildrenBreakdown'];

type Format = 'count' | 'ratio' | 'decimal' | 'share' | 'age' | 'signed';

/** How each figure reads, and its label. */
export const FIGURES: Record<string, { label: MessageKey; format: Format }> = {
  'electors.total': { label: 'analytics.electors', format: 'count' },
  'electors.male': { label: 'analytics.men', format: 'count' },
  'electors.female': { label: 'analytics.women', format: 'count' },
  'electors.thirdGender': { label: 'analytics.thirdGender', format: 'count' },
  'electors.unknown': { label: 'analytics.genderUnknown', format: 'count' },
  genderRatio: { label: 'analytics.genderRatio', format: 'ratio' },
  medianAge: { label: 'analytics.medianAge', format: 'age' },
  'ages.18-19': { label: 'analytics.firstTime', format: 'count' },
  'ages.20-29': { label: 'analytics.age20', format: 'count' },
  'ages.30-39': { label: 'analytics.age30', format: 'count' },
  'ages.40-49': { label: 'analytics.age40', format: 'count' },
  'ages.50-59': { label: 'analytics.age50', format: 'count' },
  'ages.60-79': { label: 'analytics.age60', format: 'count' },
  'ages.80+': { label: 'analytics.age80', format: 'count' },
  'ages.unknown': { label: 'analytics.ageUnknown', format: 'count' },
  'households.total': { label: 'analytics.households', format: 'count' },
  'households.large': { label: 'analytics.largeHouseholds', format: 'count' },
  votersPerHousehold: { label: 'analytics.votersPerHousehold', format: 'decimal' },
  'revisions.additions': { label: 'analytics.additions', format: 'count' },
  'revisions.deletions': { label: 'analytics.deletions', format: 'count' },
  'revisions.net': { label: 'analytics.netChange', format: 'signed' },
  extractionQuality: { label: 'analytics.extractionQuality', format: 'share' },
  'quality.rowsExtracted': { label: 'analytics.rowsExtracted', format: 'count' },
  'quality.rowsCorrected': { label: 'analytics.rowsCorrected', format: 'count' },
  'quality.rowsRejected': { label: 'analytics.rowsRejected', format: 'count' },
  'quality.duplicateEpics': { label: 'analytics.duplicateEpics', format: 'count' },
  'quality.missingAge': { label: 'analytics.missingAge', format: 'count' },
  'quality.missingGender': { label: 'analytics.missingGender', format: 'count' },
  'fieldWork.householdsAssigned': { label: 'analytics.assigned', format: 'count' },
  'fieldWork.householdsVisited': { label: 'analytics.visited', format: 'count' },
  visitedShare: { label: 'analytics.visitedShare', format: 'share' },
  'fieldWork.votersMet': { label: 'analytics.votersMet', format: 'count' },
};

/** The age bands, youngest first (18–19: first-time voters). */
export const AGE_BAND_KEYS = [
  'ages.18-19',
  'ages.20-29',
  'ages.30-39',
  'ages.40-49',
  'ages.50-59',
  'ages.60-79',
  'ages.80+',
];

export const label = (key: string) => (FIGURES[key] ? t(FIGURES[key].label) : key);

const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A figure as shown: a suppressed group is "<N" (the minimum cohort), never
 * 0; a figure that isn't collected is "Not collected"; zero is a real zero.
 */
export function formatFigure(key: string, value: Figure, minCohort: number): string {
  if (value === null) return t('analytics.notCollected');
  const format = FIGURES[key]?.format ?? 'count';
  if (value === 'suppressed') {
    // A count is a small group ("<10"); a ratio or share built from one isn't.
    return format === 'count' || format === 'signed'
      ? t('analytics.suppressed', { min: minCohort })
      : t('analytics.suppressedDerived');
  }
  switch (format) {
    case 'share':
      return `${oneDecimal.format(value * 100)}%`;
    case 'decimal':
      return twoDecimals.format(value);
    case 'age':
      return oneDecimal.format(value);
    case 'signed':
      return value > 0 ? `+${whole.format(value)}` : whole.format(value);
    default:
      return whole.format(value);
  }
}

/** For screen readers: what a suppressed or missing figure means. */
export function describeFigure(value: Figure, minCohort: number): string | null {
  if (value === null) return t('analytics.notCollectedHelp');
  if (value === 'suppressed') return t('analytics.suppressedHelp', { min: minCohort });
  return null;
}

type Child = Breakdown['children'][number];

/**
 * The children sorted by a figure, or by code. Numbers sort in the order
 * asked; suppressed figures and then missing ones always come last, since
 * their value isn't known.
 */
export function sortChildren(
  children: Child[],
  key: string | null,
  order: 'asc' | 'desc',
): Child[] {
  const byCode = (a: Child, b: Child) =>
    a.node.code.length - b.node.code.length || a.node.code.localeCompare(b.node.code);
  if (!key) return [...children].sort(byCode);
  const rank = (f: Figure) => (typeof f === 'number' ? 0 : f === 'suppressed' ? 1 : 2);
  return [...children].sort((a, b) => {
    const fa = (a.metrics[key] ?? null) as Figure;
    const fb = (b.metrics[key] ?? null) as Figure;
    if (rank(fa) !== rank(fb)) return rank(fa) - rank(fb);
    if (typeof fa === 'number' && typeof fb === 'number' && fa !== fb) {
      return order === 'asc' ? fa - fb : fb - fa;
    }
    return byCode(a, b);
  });
}

/**
 * A child far from the average of its siblings: more than `margin` (25%)
 * above or below it. Only for known numbers.
 */
export function farFromAverage(value: Figure, average: Figure, margin = 0.25): boolean {
  if (typeof value !== 'number' || typeof average !== 'number' || average === 0) return false;
  return Math.abs(value - average) / Math.abs(average) > margin;
}
