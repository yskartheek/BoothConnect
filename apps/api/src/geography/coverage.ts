import type { Coverage } from '../imports/confirm-rules';

export { covers, mostCommon } from '../imports/confirm-rules';

/**
 * Auxiliary station coverage (#101; design §2): which sections or serial
 * numbers of its part an auxiliary station takes. Everyone else stays with
 * the main station. Pure, so the checks are testable on their own.
 */

export interface SiblingCoverage {
  code: string;
  coverage: Coverage;
}

/** What is wrong with a coverage on its own: bad numbers, an empty one. */
export function coverageErrors(coverage: Coverage): string[] {
  const errors: string[] = [];
  const { sections, serials } = coverage;
  if (!sections?.length && !serials) errors.push('Give sections, a serial range, or both');
  if (sections) {
    if (sections.some((s) => !Number.isInteger(s) || s < 1)) {
      errors.push('Sections are whole numbers from 1');
    } else if (new Set(sections).size !== sections.length) {
      errors.push('A section is listed twice');
    }
  }
  if (serials) {
    const { from, to } = serials;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
      errors.push('Serial numbers are whole numbers from 1');
    } else if (from > to) {
      errors.push('The serial range starts after it ends');
    }
  }
  return errors;
}

/**
 * Where a coverage overlaps another auxiliary station's in the same part:
 * a shared section, or overlapping serial ranges. (A section of one and a
 * serial range of another can only be compared against the voters; the
 * service does that.)
 */
export function overlapErrors(coverage: Coverage, others: SiblingCoverage[]): string[] {
  const errors: string[] = [];
  for (const other of others) {
    const shared = (coverage.sections ?? []).filter((s) => other.coverage.sections?.includes(s));
    if (shared.length > 0) {
      errors.push(
        `Section${shared.length > 1 ? 's' : ''} ${shared.join(', ')} already covered by ${other.code}`,
      );
    }
    const a = coverage.serials;
    const b = other.coverage.serials;
    if (a && b && a.from <= b.to && b.from <= a.to) {
      errors.push(`Serial numbers ${a.from}–${a.to} overlap ${other.code} (${b.from}–${b.to})`);
    }
  }
  return errors;
}
