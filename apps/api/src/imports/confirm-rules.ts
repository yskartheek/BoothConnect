import {
  currentValues,
  hasOpenError,
  normaliseMessages,
  revalidate,
  type RowValues,
} from './review-rules';

/**
 * Rules for committing a confirmed file to the active dataset (#47): which
 * rows become voters, how they are grouped into households, and which
 * polling station each voter belongs to. Pure functions, shared with tests.
 */

/**
 * The house number normalised for grouping, as `household.house_key`:
 * "H NO 16-64" and "h.no. 16 - 64" both give "16-64". Null when there is no
 * usable number (the voter then gets a household of their own).
 */
export function houseKeyOf(houseNumber: unknown): string | null {
  if (typeof houseNumber !== 'string') return null;
  const key = houseNumber
    .toUpperCase()
    // Printed prefixes: "H NO", "H.NO.", "HNO", "HOUSE NO", "D NO", "DOOR NO", "NO", "#".
    .replace(/^\s*(?:(?:H(?:OUSE)?|D(?:OOR)?)\s*\.?\s*)?(?:NO|NUMBER)\s*[.:]?\s*/, '')
    .replace(/^\s*#\s*/, '')
    .replace(/\s*([-/,])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.:,-]+|[\s.:,-]+$/g, '');
  // "0", "-", "NA": the roll prints these for houses without a number.
  if (key === '' || /^0+$/.test(key) || key === 'NA' || key === 'N/A') return null;
  return key;
}

/** Which sections or serial numbers an auxiliary station covers (station metadata). */
export interface Coverage {
  sections?: number[];
  serials?: { from: number; to: number };
}

export interface StationChoice {
  id: string;
  isAuxiliary: boolean;
  coverage: Coverage | null;
}

/**
 * The station a voter votes at: the auxiliary station whose coverage has
 * the voter's section or serial number, else the main station. Coverage is
 * set on the station (design §2, #101); until it is, everyone is at the main
 * station.
 */
export function stationFor(
  main: string,
  stations: StationChoice[],
  sectionNo: number,
  serialNo: number,
): string {
  const covering = stations.find(
    ({ isAuxiliary, coverage }) =>
      isAuxiliary && coverage !== null && covers(coverage, sectionNo, serialNo),
  );
  return covering?.id ?? main;
}

/** Whether a coverage takes a voter with this section and serial number. */
export function covers(coverage: Coverage, sectionNo: number, serialNo: number): boolean {
  return (
    (coverage.sections?.includes(sectionNo) ?? false) ||
    (coverage.serials !== undefined &&
      serialNo >= coverage.serials.from &&
      serialNo <= coverage.serials.to)
  );
}

/** The most common value; a tie goes to the one seen first. A household's station, from its members'. */
export function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}

/** Station metadata's `coverage`, if it has a usable one. */
export function coverageOf(metadata: unknown): Coverage | null {
  const coverage = (metadata as { coverage?: unknown } | null)?.coverage as
    { sections?: unknown; serials?: { from?: unknown; to?: unknown } } | undefined;
  if (!coverage || typeof coverage !== 'object') return null;
  const sections = Array.isArray(coverage.sections)
    ? coverage.sections.filter((s): s is number => Number.isInteger(s))
    : undefined;
  const { from, to } = coverage.serials ?? {};
  const serials =
    Number.isInteger(from) && Number.isInteger(to)
      ? { from: from as number, to: to as number }
      : undefined;
  return sections?.length || serials ? { sections, serials } : null;
}

/** A row as stored for review, with what confirm needs. */
export interface StoredRow {
  id: string;
  status: 'accepted' | 'warning' | 'rejected';
  messages: unknown;
  extractedValues: unknown;
  correctedValues: unknown;
  sectionNo: number | null;
  serialNo: number | null;
  rawText: string | null;
}

export interface VoterRow {
  rowId: string;
  epic: string;
  sectionNo: number;
  serialNo: number;
  houseNumber: string | null;
  /** The official record: values with the admin's corrections applied. */
  sourceData: Record<string, unknown>;
}

export type Preparation =
  | { ok: true; voters: VoterRow[]; skipped: { rejected: number; deleted: number } }
  | { ok: false; code: string; message: string; rowIds: string[] };

const SOURCE_FIELDS = [
  'name',
  'relationType',
  'relativeName',
  'houseNumber',
  'age',
  'gender',
  'marker',
] as const;

/**
 * The voters a file will add. Rejected rows and entries marked deleted on
 * the roll are left out. Anything that would make a bad voter record stops
 * the confirm: an open error, a missing EPIC, section or serial, or an EPIC
 * listed twice.
 */
export function prepareVoters(rows: StoredRow[]): Preparation {
  const voters: VoterRow[] = [];
  const skipped = { rejected: 0, deleted: 0 };
  const blocked: string[] = [];
  for (const row of rows) {
    if (row.status === 'rejected') {
      skipped.rejected += 1;
      continue;
    }
    const corrected = (row.correctedValues as RowValues | null) ?? null;
    const current = currentValues(row.extractedValues as RowValues, row.sectionNo, corrected);
    if (current.marker === 'deleted') {
      skipped.deleted += 1;
      continue;
    }
    const epic = current.epic;
    const section = current.sectionNumber;
    if (
      // Same rule as review: a message about a corrected field is resolved.
      hasOpenError(row.status, revalidate(normaliseMessages(row.messages), corrected, null, [])) ||
      typeof epic !== 'string' ||
      typeof section !== 'number' ||
      row.serialNo === null
    ) {
      blocked.push(row.id);
      continue;
    }
    voters.push({
      rowId: row.id,
      epic,
      sectionNo: section,
      serialNo: row.serialNo,
      houseNumber: typeof current.houseNumber === 'string' ? current.houseNumber : null,
      sourceData: {
        ...Object.fromEntries(SOURCE_FIELDS.map((f) => [f, current[f] ?? null])),
        rawText: row.rawText,
        // Which values an admin corrected (the extracted ones stay on the row result).
        corrected: Object.keys(corrected ?? {}).sort(),
      },
    });
  }
  if (blocked.length > 0) {
    return {
      ok: false,
      code: 'rows.unresolved',
      message: `${blocked.length} row(s) still have errors or miss the EPIC, section or serial; correct or reject them first`,
      rowIds: blocked,
    };
  }
  for (const [key, code, what] of [
    [(v: VoterRow) => v.epic, 'rows.duplicate_epic', 'EPIC numbers'],
    [(v: VoterRow) => String(v.serialNo), 'rows.duplicate_serial', 'serial numbers'],
  ] as const) {
    const duplicates = duplicatesBy(voters, key);
    if (duplicates.length > 0) {
      return {
        ok: false,
        code,
        message: `Some ${what} are listed more than once; correct or reject the extra rows`,
        rowIds: duplicates,
      };
    }
  }
  return { ok: true, voters, skipped };
}

function duplicatesBy(voters: VoterRow[], key: (voter: VoterRow) => string): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const voter of voters) {
    const first = seen.get(key(voter));
    if (first) duplicates.add(first).add(voter.rowId);
    else seen.set(key(voter), voter.rowId);
  }
  return [...duplicates];
}
