import { AGE_BANDS, derive, METRIC_DEFINITIONS, type RawMetrics, VISIT_OUTCOMES } from './metrics';

/**
 * What the analytics API shows (#49; design §7, spec §8.2): a flat set of
 * figures per node, each a number, `"suppressed"` (a group smaller than the
 * minimum cohort, or one that could be worked out from the others), or
 * `null` (not collected: e.g. no visits yet, no earlier revision). Zero is
 * a real zero.
 *
 * Suppression, in order:
 * 1. every count of people or households between 1 and cohort − 1;
 * 2. within a breakdown (gender, age bands, visit outcomes) with its total
 *    shown, a single suppressed category would be total − the others, so
 *    the smallest other non-zero category is suppressed too;
 * 3. across a node's children: a single suppressed child would be parent −
 *    the other children, so the smallest other child is suppressed too (or
 *    the parent's figure, if no other child has one);
 * 4. derived figures (ratios, median, averages) are suppressed when a count
 *    they are built from is.
 * Steps 2 and 3 repeat until nothing changes.
 */

export type Figure = number | 'suppressed' | null;
export type Figures = Record<string, Figure>;
export const SUPPRESSED = 'suppressed' as const;

const BAND_KEYS = AGE_BANDS.map((b) => `ages.${b.key}`);
const OUTCOME_KEYS = VISIT_OUTCOMES.map((o) => `fieldWork.outcomes.${o}`);

/** Counts of people or households: the figures the cohort rule applies to. */
export const COUNT_KEYS = [
  'electors.total',
  'electors.male',
  'electors.female',
  'electors.thirdGender',
  'electors.unknown',
  ...BAND_KEYS,
  'ages.unknown',
  'households.total',
  'households.large',
  'revisions.additions',
  'revisions.deletions',
  'quality.rowsExtracted',
  'quality.rowsCorrected',
  'quality.rowsRejected',
  'quality.duplicateEpics',
  'quality.missingAge',
  'quality.missingGender',
  'fieldWork.householdsAssigned',
  'fieldWork.householdsVisited',
  'fieldWork.votersMet',
  ...OUTCOME_KEYS,
];

/** Breakdowns: a total and categories that add up to it. */
const GROUPS: { total: string; cells: string[] }[] = [
  {
    total: 'electors.total',
    cells: ['electors.male', 'electors.female', 'electors.thirdGender', 'electors.unknown'],
  },
  { total: 'electors.total', cells: [...BAND_KEYS, 'ages.unknown'] },
  { total: 'fieldWork.householdsVisited', cells: OUTCOME_KEYS },
];

/** Figures computed from counts: suppressed when one of their counts is. */
const DERIVED: { key: string; from: string[] }[] = [
  { key: 'genderRatio', from: ['electors.male', 'electors.female'] },
  { key: 'medianAge', from: ['ages.known'] },
  { key: 'votersPerHousehold', from: ['electors.total', 'households.total'] },
  { key: 'extractionQuality', from: [] },
  { key: 'visitedShare', from: ['fieldWork.householdsAssigned', 'fieldWork.householdsVisited'] },
  { key: 'revisions.net', from: ['revisions.additions', 'revisions.deletions'] },
];

export const FIGURE_KEYS = [...COUNT_KEYS, ...DERIVED.map((d) => d.key)];

/** The raw figures of a node, before suppression. */
export function rawFigures(m: RawMetrics): Record<string, number | null> {
  const d = derive(m);
  const quality = m.quality.files > 0;
  const fieldWork = m.fieldWork.householdsAssigned > 0 || m.fieldWork.householdsVisited > 0;
  const revisions = m.revisions.stationsCompared > 0;
  const bands = Object.fromEntries(AGE_BANDS.map((b) => [`ages.${b.key}`, d.ageBands[b.key]]));
  const outcomes = Object.fromEntries(
    VISIT_OUTCOMES.map((o) => [
      `fieldWork.outcomes.${o}`,
      fieldWork ? (m.fieldWork.outcomes[o] ?? 0) : null,
    ]),
  );
  return {
    'electors.total': m.electors.total,
    'electors.male': m.electors.male,
    'electors.female': m.electors.female,
    'electors.thirdGender': m.electors.thirdGender,
    'electors.unknown': m.electors.unknown,
    ...bands,
    'ages.unknown': m.ages.unknown,
    'ages.known': m.electors.total - m.ages.unknown,
    'households.total': m.households.total,
    'households.large': m.households.large,
    'revisions.additions': revisions ? m.revisions.additions : null,
    'revisions.deletions': revisions ? m.revisions.deletions : null,
    'quality.rowsExtracted': quality ? m.quality.rowsExtracted : null,
    'quality.rowsCorrected': quality ? m.quality.rowsCorrected : null,
    'quality.rowsRejected': quality ? m.quality.rowsRejected : null,
    'quality.duplicateEpics': m.quality.duplicateEpics,
    'quality.missingAge': m.quality.missingAge,
    'quality.missingGender': m.quality.missingGender,
    'fieldWork.householdsAssigned': fieldWork ? m.fieldWork.householdsAssigned : null,
    'fieldWork.householdsVisited': fieldWork ? m.fieldWork.householdsVisited : null,
    'fieldWork.votersMet': fieldWork ? m.fieldWork.votersMet : null,
    ...outcomes,
    genderRatio: d.genderRatio,
    medianAge: d.medianAge,
    votersPerHousehold: d.votersPerHousehold,
    extractionQuality: d.extractionQuality,
    visitedShare: fieldWork ? d.visitedShare : null,
    'revisions.net': revisions ? d.netChange : null,
  };
}

type Cells = Record<string, Figure>;

const isSmall = (value: number | null, cohort: number) =>
  value !== null && value > 0 && value < cohort;

/** Step 1: small counts. `ages.known` is kept (hidden) for the median. */
function primary(raw: Record<string, number | null>, cohort: number): Cells {
  const cells: Cells = {};
  for (const key of [...COUNT_KEYS, 'ages.known']) {
    const value = raw[key] ?? null;
    cells[key] = isSmall(value, cohort) ? SUPPRESSED : value;
  }
  return cells;
}

/** Suppresses the smallest shown non-zero cell among `keys`; false if there is none. */
function suppressSmallest(cells: Cells, keys: string[]): boolean {
  let best: string | null = null;
  for (const key of keys) {
    const value = cells[key];
    if (
      typeof value === 'number' &&
      value > 0 &&
      (best === null || value < (cells[best] as number))
    ) {
      best = key;
    }
  }
  if (best === null) return false;
  cells[best] = SUPPRESSED;
  return true;
}

/** Step 2 on one node; true if it changed anything. */
function complementWithin(cells: Cells): boolean {
  let changed = false;
  for (const { total, cells: keys } of GROUPS) {
    if (typeof cells[total] !== 'number') continue;
    const hidden = keys.filter((k) => cells[k] === SUPPRESSED);
    if (hidden.length !== 1) continue;
    const others = keys.filter((k) => k !== hidden[0]);
    if (!suppressSmallest(cells, others)) cells[total] = SUPPRESSED;
    changed = true;
  }
  return changed;
}

/** Step 3 for one parent and its children; true if it changed anything. */
function complementAcross(parent: Cells, children: Cells[]): boolean {
  let changed = false;
  for (const key of COUNT_KEYS) {
    if (typeof parent[key] !== 'number') continue;
    const hidden = children.filter((c) => c[key] === SUPPRESSED);
    if (hidden.length !== 1) continue;
    let best: Cells | null = null;
    for (const child of children) {
      const value = child[key];
      if (typeof value === 'number' && value > 0 && (!best || value < (best[key] as number))) {
        best = child;
      }
    }
    if (best) best[key] = SUPPRESSED;
    else parent[key] = SUPPRESSED;
    changed = true;
  }
  return changed;
}

/** Step 4, and the final shape (without the hidden `ages.known`). */
function finish(cells: Cells, raw: Record<string, number | null>, cohort: number): Figures {
  const out: Figures = {};
  for (const key of COUNT_KEYS) out[key] = cells[key] ?? null;
  for (const { key, from } of DERIVED) {
    const value = raw[key] ?? null;
    out[key] =
      value === null
        ? null
        : from.some((k) => cells[k] === SUPPRESSED || isSmall(raw[k] ?? null, cohort))
          ? SUPPRESSED
          : value;
  }
  return out;
}

/** One node on its own (a root, with nothing to compare against). */
export function suppressNode(m: RawMetrics, cohort: number): Figures {
  const raw = rawFigures(m);
  const cells = primary(raw, cohort);
  while (complementWithin(cells)) {
    // until stable
  }
  return finish(cells, raw, cohort);
}

/**
 * A parent and its children together, as the children table shows them.
 * A node's summary is its row here (among its siblings), so the two views
 * can't be combined to undo a suppression.
 */
export function suppressFamily(
  parent: RawMetrics,
  children: RawMetrics[],
  cohort: number,
): { parent: Figures; children: Figures[] } {
  const rawParent = rawFigures(parent);
  const rawChildren = children.map(rawFigures);
  const p = primary(rawParent, cohort);
  const cs = rawChildren.map((r) => primary(r, cohort));
  for (let changed = true; changed;) {
    changed = complementWithin(p);
    for (const c of cs) changed = complementWithin(c) || changed;
    changed = complementAcross(p, cs) || changed;
  }
  return {
    parent: finish(p, rawParent, cohort),
    children: cs.map((c, i) => finish(c, rawChildren[i]!, cohort)),
  };
}

/** The definition shown with a figure (design §7: every card shows one). */
export function definitionOf(key: string): string {
  if (key.startsWith('ages.') && key !== 'ages.unknown') return METRIC_DEFINITIONS.ageBands!;
  if (key.startsWith('fieldWork.outcomes.')) return METRIC_DEFINITIONS['fieldWork.outcomes']!;
  if (key === 'revisions.net') return METRIC_DEFINITIONS.netChange!;
  return METRIC_DEFINITIONS[key] ?? '';
}
