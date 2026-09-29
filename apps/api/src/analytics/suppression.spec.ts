import { emptyMetrics, type RawMetrics } from './metrics';
import { COUNT_KEYS, rawFigures, SUPPRESSED, suppressFamily, suppressNode } from './suppression';

const K = 10;

/** A node with `male` men and `female` women, all aged 30, in `households` houses. */
const node = (male: number, female: number, patch: (m: RawMetrics) => void = () => {}) => {
  const m = emptyMetrics();
  m.electors = { total: male + female, male, female, thirdGender: 0, unknown: 0 };
  m.ages.byAge = male + female > 0 ? { '30': male + female } : {};
  m.households = { total: Math.ceil((male + female) / 3), large: 0 };
  patch(m);
  return m;
};

describe('analytics suppression', () => {
  it('shows counts of the cohort size or more, and real zeros', () => {
    const f = suppressNode(node(40, 35), K);
    expect(f['electors.total']).toBe(75);
    expect(f['electors.male']).toBe(40);
    expect(f['electors.thirdGender']).toBe(0);
    expect(f['ages.30-39']).toBe(75);
    expect(f['ages.18-19']).toBe(0);
    expect(f.genderRatio).toBe(875);
    expect(f.medianAge).toBe(30);
  });

  it('suppresses small groups, and derived figures built from them', () => {
    const f = suppressNode(node(4, 3), K);
    for (const key of ['electors.total', 'electors.male', 'electors.female', 'households.total']) {
      expect(f[key]).toBe(SUPPRESSED);
    }
    expect(f.genderRatio).toBe(SUPPRESSED);
    expect(f.medianAge).toBe(SUPPRESSED);
    expect(f.votersPerHousehold).toBe(SUPPRESSED);
  });

  it('suppresses a second category when one could be worked out by subtraction', () => {
    // 50 voters: 44 men, 6 women. Hiding only the women would leave 50 − 44.
    const f = suppressNode(node(44, 6), K);
    expect(f['electors.female']).toBe(SUPPRESSED);
    expect(f['electors.male']).toBe(SUPPRESSED);
    expect(f['electors.total']).toBe(50);
    expect(f.genderRatio).toBe(SUPPRESSED);
    // Two small categories can't be told apart: nothing more is hidden.
    const two = suppressNode(
      node(40, 0, (m) => {
        m.electors = { total: 48, male: 40, female: 5, thirdGender: 3, unknown: 0 };
      }),
      K,
    );
    expect(two['electors.male']).toBe(40);
    expect([two['electors.female'], two['electors.thirdGender']]).toEqual([SUPPRESSED, SUPPRESSED]);
  });

  it('keeps "not collected" apart from zero', () => {
    const f = suppressNode(node(40, 35), K);
    // No earlier revision, no import quality, no field work yet.
    expect(f['revisions.additions']).toBeNull();
    expect(f['revisions.net']).toBeNull();
    expect(f['quality.rowsExtracted']).toBeNull();
    expect(f['fieldWork.householdsVisited']).toBeNull();
    expect(f['fieldWork.outcomes.completed']).toBeNull();
    // Collected, and zero.
    expect(f['quality.duplicateEpics']).toBe(0);
    const compared = suppressNode(
      node(40, 35, (m) => {
        m.revisions = { additions: 0, deletions: 0, stationsCompared: 1 };
      }),
      K,
    );
    expect(compared['revisions.additions']).toBe(0);
    expect(compared['revisions.net']).toBe(0);
  });

  it('applies the rule to visit outcomes within the visited households', () => {
    const f = suppressNode(
      node(40, 35, (m) => {
        m.fieldWork = {
          householdsAssigned: 30,
          householdsVisited: 25,
          outcomes: { completed: 18, refused: 7 },
          votersMet: 40,
        };
      }),
      K,
    );
    expect(f['fieldWork.outcomes.refused']).toBe(SUPPRESSED);
    // Otherwise completed = 25 − 7 would give it away.
    expect(f['fieldWork.outcomes.completed']).toBe(SUPPRESSED);
    expect(f['fieldWork.outcomes.no_one_available']).toBe(0);
    expect(f.visitedShare).toBe(0.833);
  });

  it('in a children table, a single small child is protected from parent − siblings', () => {
    const children = [node(30, 30), node(20, 25), node(3, 4)];
    const parent = node(53, 59);
    const { parent: p, children: c } = suppressFamily(parent, children, K);
    expect(c[2]!['electors.total']).toBe(SUPPRESSED);
    // The next smallest child's total is hidden too, and the parent's stays.
    expect(c[1]!['electors.total']).toBe(SUPPRESSED);
    expect(c[0]!['electors.total']).toBe(60);
    expect(p['electors.total']).toBe(112);
    // No count column has exactly one hidden child left (medians and ratios
    // can't be worked out by subtraction).
    for (const key of COUNT_KEYS) {
      const hidden = c.filter((x) => x[key] === SUPPRESSED).length;
      if (typeof p[key] === 'number') expect(hidden).not.toBe(1);
    }
  });

  it("hides the parent's figure when no sibling can cover a single small child", () => {
    const children = [node(0, 0), node(4, 8)];
    const parent = node(4, 8);
    const { parent: p, children: c } = suppressFamily(parent, children, K);
    expect(c[1]!['electors.total']).toBe(12);
    expect(c[1]!['electors.male']).toBe(SUPPRESSED);
    expect(p['electors.male']).toBe(SUPPRESSED);
  });

  it('exposes every figure with the raw values it came from', () => {
    const raw = rawFigures(node(40, 35));
    expect(raw['ages.known']).toBe(75);
    expect(Object.keys(suppressNode(node(40, 35), K))).not.toContain('ages.known');
  });
});
