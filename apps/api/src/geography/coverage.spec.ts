import { coverageErrors, overlapErrors } from './coverage';

describe('coverageErrors', () => {
  it('accepts sections, a serial range, or both', () => {
    expect(coverageErrors({ sections: [2, 3] })).toEqual([]);
    expect(coverageErrors({ serials: { from: 1, to: 1 } })).toEqual([]);
    expect(coverageErrors({ sections: [1], serials: { from: 5, to: 9 } })).toEqual([]);
  });

  it('rejects an empty coverage, repeated sections and backwards ranges', () => {
    expect(coverageErrors({})).toEqual(['Give sections, a serial range, or both']);
    expect(coverageErrors({ sections: [] })).toEqual(['Give sections, a serial range, or both']);
    expect(coverageErrors({ sections: [2, 2] })).toEqual(['A section is listed twice']);
    expect(coverageErrors({ sections: [0] })).toEqual(['Sections are whole numbers from 1']);
    expect(coverageErrors({ serials: { from: 9, to: 5 } })).toEqual([
      'The serial range starts after it ends',
    ]);
  });
});

describe('overlapErrors', () => {
  const others = [
    { code: '408A', coverage: { sections: [2, 3] } },
    { code: '408B', coverage: { serials: { from: 100, to: 200 } } },
  ];

  it('finds shared sections and overlapping ranges, ends included', () => {
    expect(overlapErrors({ sections: [3, 4, 2] }, others)).toEqual([
      'Sections 3, 2 already covered by 408A',
    ]);
    expect(overlapErrors({ serials: { from: 200, to: 250 } }, others)).toEqual([
      'Serial numbers 200–250 overlap 408B (100–200)',
    ]);
    expect(overlapErrors({ serials: { from: 50, to: 100 } }, others)).toHaveLength(1);
  });

  it('adjacent ranges and other sections are fine', () => {
    expect(overlapErrors({ serials: { from: 201, to: 300 } }, others)).toEqual([]);
    expect(overlapErrors({ serials: { from: 1, to: 99 } }, others)).toEqual([]);
    expect(overlapErrors({ sections: [1, 4] }, others)).toEqual([]);
  });
});
