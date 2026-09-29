import { describeFigure, farFromAverage, formatFigure, sortChildren } from './figures';

describe('formatFigure', () => {
  it('shows a suppressed group as "<N", never 0, and a missing figure as not collected', () => {
    expect(formatFigure('electors.male', 'suppressed', 10)).toBe('<10');
    expect(formatFigure('households.total', 'suppressed', 20)).toBe('<20');
    // A ratio from a suppressed count isn't a small group itself.
    expect(formatFigure('genderRatio', 'suppressed', 10)).toBe('Suppressed');
    expect(formatFigure('visitedShare', 'suppressed', 10)).toBe('Suppressed');
    expect(formatFigure('fieldWork.householdsVisited', null, 10)).toBe('Not collected');
    // Zero is a real zero.
    expect(formatFigure('electors.thirdGender', 0, 10)).toBe('0');
  });

  it('formats counts, ratios, shares, decimals and changes', () => {
    expect(formatFigure('electors.total', 123456, 10)).toBe('1,23,456');
    expect(formatFigure('genderRatio', 962, 10)).toBe('962');
    expect(formatFigure('extractionQuality', 0.9134, 10)).toBe('91.3%');
    expect(formatFigure('visitedShare', 0, 10)).toBe('0%');
    expect(formatFigure('votersPerHousehold', 3.5, 10)).toBe('3.50');
    expect(formatFigure('medianAge', 41.25, 10)).toBe('41.3');
    expect(formatFigure('revisions.net', 12, 10)).toBe('+12');
    expect(formatFigure('revisions.net', -4, 10)).toBe('-4');
    expect(formatFigure('revisions.net', 0, 10)).toBe('0');
  });

  it('explains suppressed and missing figures for screen readers', () => {
    expect(describeFigure('suppressed', 10)).toMatch(/^Fewer than 10 people/);
    expect(describeFigure(null, 10)).toMatch(/^Not collected yet/);
    expect(describeFigure(5, 10)).toBeNull();
  });
});

describe('sortChildren', () => {
  const child = (code: string, value: number | 'suppressed' | null) => ({
    node: { id: code, type: 'part' as const, code, name: `Part ${code}` },
    computedAt: null,
    metrics: { 'electors.total': value },
  });
  const children = [
    child('10', 300),
    child('2', 'suppressed'),
    child('1', 500),
    child('3', null),
    child('4', 100),
    child('5', 300),
  ];
  const codes = (list: { node: { code: string } }[]) => list.map((c) => c.node.code);

  it('sorts by code (numerically) without a figure', () => {
    expect(codes(sortChildren(children, null, 'asc'))).toEqual(['1', '2', '3', '4', '5', '10']);
  });

  it('sorts numbers either way, with suppressed and then missing figures last', () => {
    expect(codes(sortChildren(children, 'electors.total', 'desc'))).toEqual([
      '1',
      '5',
      '10',
      '4',
      '2',
      '3',
    ]);
    expect(codes(sortChildren(children, 'electors.total', 'asc'))).toEqual([
      '4',
      '5',
      '10',
      '1',
      '2',
      '3',
    ]);
  });

  it('doesn’t change the list it is given', () => {
    const before = codes(children);
    sortChildren(children, 'electors.total', 'asc');
    expect(codes(children)).toEqual(before);
  });
});

describe('farFromAverage', () => {
  it('is more than 25% above or below a known average', () => {
    expect(farFromAverage(126, 100)).toBe(true);
    expect(farFromAverage(74, 100)).toBe(true);
    expect(farFromAverage(125, 100)).toBe(false);
    expect(farFromAverage(80, 100)).toBe(false);
    expect(farFromAverage('suppressed', 100)).toBe(false);
    expect(farFromAverage(50, null)).toBe(false);
    expect(farFromAverage(5, 0)).toBe(false);
  });
});
