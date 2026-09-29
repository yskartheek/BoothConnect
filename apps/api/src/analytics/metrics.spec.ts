import { addMetrics, derive, emptyMetrics, type RawMetrics, sumMetrics } from './metrics';

const with_ = (patch: (m: RawMetrics) => void): RawMetrics => {
  const m = emptyMetrics();
  patch(m);
  return m;
};

describe('analytics metrics', () => {
  it('adds raw counts key by key, at any depth', () => {
    const a = with_((m) => {
      m.electors.total = 3;
      m.ages.byAge = { '30': 2, '41': 1 };
      m.fieldWork.outcomes = { completed: 1 };
    });
    const b = with_((m) => {
      m.electors.total = 2;
      m.ages.byAge = { '30': 1, '85': 1 };
      m.fieldWork.outcomes = { refused: 2 };
    });
    const sum = addMetrics(a, b);
    expect(sum.electors.total).toBe(5);
    expect(sum.ages.byAge).toEqual({ '30': 3, '41': 1, '85': 1 });
    expect(sum.fieldWork.outcomes).toEqual({ completed: 1, refused: 2 });
    // Inputs are left alone.
    expect(a.electors.total).toBe(3);
    expect(sumMetrics([a, b, null, undefined])).toEqual(sum);
    expect(sumMetrics([])).toEqual(emptyMetrics());
  });

  it('derives ratio, bands, median and averages', () => {
    const m = with_((x) => {
      x.electors = { total: 6, male: 2, female: 3, thirdGender: 0, unknown: 1 };
      x.ages.byAge = { '18': 1, '19': 1, '25': 1, '60': 1, '79': 1, '95': 1 };
      x.households = { total: 4, large: 0 };
      x.quality.files = 2;
      x.quality.qualitySum = 1.7;
      x.fieldWork.householdsAssigned = 4;
      x.fieldWork.householdsVisited = 1;
      x.revisions = { additions: 5, deletions: 7, stationsCompared: 1 };
    });
    expect(derive(m)).toEqual({
      genderRatio: 1500,
      ageBands: {
        '18-19': 2,
        '20-29': 1,
        '30-39': 0,
        '40-49': 0,
        '50-59': 0,
        '60-79': 2,
        '80+': 1,
      },
      // Six ages: the lower middle one.
      medianAge: 25,
      votersPerHousehold: 1.5,
      extractionQuality: 0.85,
      visitedShare: 0.25,
      netChange: -2,
    });
  });

  it('leaves figures that need a denominator null without one', () => {
    expect(derive(emptyMetrics())).toMatchObject({
      genderRatio: null,
      medianAge: null,
      votersPerHousehold: null,
      extractionQuality: null,
      visitedShare: null,
      netChange: 0,
    });
  });
});
