/**
 * Analytics metrics (#102; design §7), defined once and shared by the
 * refresh job and the API (#49).
 *
 * `node_stats` stores **raw, additive counts** (`RawMetrics`), so a parent's
 * figures are the sum of its children's plus its own. Everything else
 * (ratios, averages, medians, age bands) is derived from them with
 * `derive()`. Suppressing small groups is the API's job, when it reads.
 *
 * Only what the roll prints (age, gender, household, revision changes) and
 * field-work status are counted: never names or anything inferred from them.
 */

export const VISIT_OUTCOMES = [
  'completed',
  'partially_completed',
  'no_one_available',
  'refused',
  'address_not_found',
  'household_moved',
  'voter_deceased',
  'duplicate_or_incorrect_listing',
  'follow_up_requested',
  'unsafe_or_inaccessible',
] as const;

/** Oldest single year counted on its own; older ages count as this one. */
export const MAX_AGE = 120;
/** A household with more voters than this is "large" (often a data issue). */
export const LARGE_HOUSEHOLD = 10;
/** Design §7 bands; `[from, to]` inclusive. */
export const AGE_BANDS = [
  { key: '18-19', from: 18, to: 19 },
  { key: '20-29', from: 20, to: 29 },
  { key: '30-39', from: 30, to: 39 },
  { key: '40-49', from: 40, to: 49 },
  { key: '50-59', from: 50, to: 59 },
  { key: '60-79', from: 60, to: 79 },
  { key: '80+', from: 80, to: MAX_AGE },
] as const;

export interface RawMetrics {
  /** Active voters (official and volunteer-added), by gender as printed. */
  electors: { total: number; male: number; female: number; thirdGender: number; unknown: number };
  /** Voters by age as printed: `byAge["34"]`; `unknown` without one. */
  ages: { byAge: Record<string, number>; unknown: number };
  /** Active households; `large` = more than LARGE_HOUSEHOLD active voters. */
  households: { total: number; large: number };
  /**
   * Against the part's previous revision. `stationsCompared` counts the
   * stations whose part has one, so "no earlier revision" isn't mistaken
   * for "no change".
   */
  revisions: { additions: number; deletions: number; stationsCompared: number };
  quality: {
    /** Confirmed import files of the current revisions, and their quality scores summed. */
    files: number;
    qualitySum: number;
    rowsExtracted: number;
    rowsCorrected: number;
    rowsRejected: number;
    /** Active voters whose EPIC is also on another active voter of the program. */
    duplicateEpics: number;
    /** Official voters without an age or gender in their record. */
    missingAge: number;
    missingGender: number;
  };
  fieldWork: {
    /** Active households at stations with a volunteer assigned. */
    householdsAssigned: number;
    /** Active households with at least one visit (corrected visits count once). */
    householdsVisited: number;
    /** Latest visit outcome per visited household. */
    outcomes: Record<string, number>;
    /** Active voters met on a visit. */
    votersMet: number;
  };
}

export function emptyMetrics(): RawMetrics {
  return {
    electors: { total: 0, male: 0, female: 0, thirdGender: 0, unknown: 0 },
    ages: { byAge: {}, unknown: 0 },
    households: { total: 0, large: 0 },
    revisions: { additions: 0, deletions: 0, stationsCompared: 0 },
    quality: {
      files: 0,
      qualitySum: 0,
      rowsExtracted: 0,
      rowsCorrected: 0,
      rowsRejected: 0,
      duplicateEpics: 0,
      missingAge: 0,
      missingGender: 0,
    },
    fieldWork: { householdsAssigned: 0, householdsVisited: 0, outcomes: {}, votersMet: 0 },
  };
}

type Tree = { [key: string]: number | Tree };

/** Adds `b` into a copy of `a`, key by key, at any depth (missing keys count as 0). */
export function addMetrics(a: RawMetrics, b: Partial<RawMetrics> | null | undefined): RawMetrics {
  return add(a as unknown as Tree, b ?? {}) as unknown as RawMetrics;
}

function add(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const mine = out[key];
    if (typeof value === 'number') {
      out[key] = (typeof mine === 'number' ? mine : 0) + value;
    } else if (value && typeof value === 'object') {
      out[key] = add(mine && typeof mine === 'object' ? mine : {}, value);
    }
  }
  return out;
}

export function sumMetrics(parts: (Partial<RawMetrics> | null | undefined)[]): RawMetrics {
  return parts.reduce<RawMetrics>((total, part) => addMetrics(total, part), emptyMetrics());
}

export interface DerivedMetrics {
  /** Women per 1,000 men; null without men. */
  genderRatio: number | null;
  ageBands: Record<(typeof AGE_BANDS)[number]['key'], number>;
  /** Median age of voters with a known age; null without any. */
  medianAge: number | null;
  /** Voters per active household; null without households. */
  votersPerHousehold: number | null;
  /** Average extraction quality (0–1) of the confirmed files; null without files. */
  extractionQuality: number | null;
  /** Visited ÷ assigned households (0–1); null when none are assigned. */
  visitedShare: number | null;
  /** Additions − deletions. */
  netChange: number;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export function derive(m: RawMetrics): DerivedMetrics {
  const ages = Object.entries(m.ages.byAge)
    .map(([age, count]) => [Number(age), count] as const)
    .sort((a, b) => a[0] - b[0]);
  const known = ages.reduce((n, [, count]) => n + count, 0);
  let medianAge: number | null = null;
  if (known > 0) {
    // The lower median for an even count: an age someone actually has.
    let seen = 0;
    for (const [age, count] of ages) {
      seen += count;
      if (seen >= known / 2) {
        medianAge = age;
        break;
      }
    }
  }
  const ageBands = Object.fromEntries(
    AGE_BANDS.map(({ key, from, to }) => [
      key,
      ages.filter(([age]) => age >= from && age <= to).reduce((n, [, c]) => n + c, 0),
    ]),
  ) as DerivedMetrics['ageBands'];
  return {
    genderRatio:
      m.electors.male > 0 ? Math.round((m.electors.female / m.electors.male) * 1000) : null,
    ageBands,
    medianAge,
    votersPerHousehold:
      m.households.total > 0 ? round(m.electors.total / m.households.total, 2) : null,
    extractionQuality:
      m.quality.files > 0 ? round(m.quality.qualitySum / m.quality.files, 3) : null,
    visitedShare:
      m.fieldWork.householdsAssigned > 0
        ? round(m.fieldWork.householdsVisited / m.fieldWork.householdsAssigned, 3)
        : null,
    netChange: m.revisions.additions - m.revisions.deletions,
  };
}

/** What each metric means, for the API and the analytics screens (design §7). */
export const METRIC_DEFINITIONS: Record<string, string> = {
  'electors.total':
    'Active voters in this area: official roll entries and members added by volunteers.',
  'electors.male': 'Active voters printed as male on the roll.',
  'electors.female': 'Active voters printed as female on the roll.',
  'electors.thirdGender': 'Active voters printed as third gender on the roll.',
  'electors.unknown': 'Active voters without a gender on the roll (e.g. added by volunteers).',
  genderRatio: 'Women per 1,000 men.',
  ageBands:
    'Voters by age as printed on the roll: 18–19 (first-time voters), 20–29, …, 60–79, 80+.',
  medianAge: 'The middle age of voters with a known age.',
  'ages.unknown': 'Voters without an age on the roll.',
  'households.total': 'Active households.',
  'households.large': `Households with more than ${LARGE_HOUSEHOLD} voters (often a data issue).`,
  votersPerHousehold: 'Active voters per active household.',
  'revisions.additions': "Voters in the current revision who weren't in the previous one.",
  'revisions.deletions': 'Voters in the previous revision who are no longer listed.',
  netChange: 'Additions minus deletions.',
  extractionQuality: 'Average reading quality (0–1) of the confirmed roll files.',
  'quality.rowsExtracted': 'Voter boxes read from the confirmed roll files.',
  'quality.rowsCorrected': 'Rows an admin corrected during review.',
  'quality.rowsRejected': 'Rows an admin rejected during review.',
  'quality.duplicateEpics':
    'Active voters whose EPIC number is also listed for another active voter.',
  'quality.missingAge': 'Roll entries without a readable age.',
  'quality.missingGender': 'Roll entries without a readable gender.',
  'fieldWork.householdsAssigned':
    'Active households at polling stations with a volunteer assigned.',
  'fieldWork.householdsVisited': 'Active households visited at least once.',
  visitedShare: 'Visited households out of assigned households.',
  'fieldWork.outcomes': 'Outcome of the latest visit to each visited household.',
  'fieldWork.votersMet': 'Active voters met on a visit.',
};
