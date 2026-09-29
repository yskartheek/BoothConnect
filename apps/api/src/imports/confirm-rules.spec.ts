import {
  coverageOf,
  houseKeyOf,
  prepareVoters,
  type StationChoice,
  stationFor,
  type StoredRow,
} from './confirm-rules';

const row = (i: number, values: Record<string, unknown> = {}, extra: Partial<StoredRow> = {}) =>
  ({
    id: `row-${i}`,
    status: 'accepted',
    messages: [],
    extractedValues: {
      epic: `TST${1_000_000 + i}`,
      name: `Synthetic Person ${i}`,
      relationType: 'father',
      relativeName: `Synthetic Relative ${i}`,
      houseNumber: `${i}`,
      age: 30,
      gender: 'male',
      printedSerial: i,
      marker: null,
      ...values,
    },
    correctedValues: null,
    sectionNo: 1,
    serialNo: i,
    rawText: `${i} synthetic`,
    ...extra,
  }) satisfies StoredRow;

describe('confirm rules', () => {
  it('normalises house numbers for grouping', () => {
    expect(houseKeyOf('H NO 16-64')).toBe('16-64');
    expect(houseKeyOf('h.no. 16 - 64')).toBe('16-64');
    expect(houseKeyOf('HNO 3/2')).toBe('3/2');
    expect(houseKeyOf('House No: 12A')).toBe('12A');
    expect(houseKeyOf('D.No 4-5-6')).toBe('4-5-6');
    expect(houseKeyOf('# 7')).toBe('7');
    expect(houseKeyOf('16-64')).toBe('16-64');
    expect(houseKeyOf('  1  ')).toBe('1');
    for (const none of ['0', '00', '-', 'NA', 'n/a', '', null, 12]) {
      expect(houseKeyOf(none)).toBeNull();
    }
  });

  it('puts voters at the auxiliary station covering them, else the main one', () => {
    const stations: StationChoice[] = [
      { id: 'main', isAuxiliary: false, coverage: null },
      { id: 'aux-a', isAuxiliary: true, coverage: { sections: [2, 3] } },
      { id: 'aux-b', isAuxiliary: true, coverage: { serials: { from: 500, to: 600 } } },
      { id: 'aux-c', isAuxiliary: true, coverage: null },
    ];
    expect(stationFor('main', stations, 1, 10)).toBe('main');
    expect(stationFor('main', stations, 3, 10)).toBe('aux-a');
    expect(stationFor('main', stations, 1, 500)).toBe('aux-b');
    expect(stationFor('main', stations, 1, 601)).toBe('main');
    expect(coverageOf({ coverage: { sections: [2, 'x'] } })).toEqual({
      sections: [2],
      serials: undefined,
    });
    expect(coverageOf({ coverage: { serials: { from: 1, to: 9 } } })?.serials).toEqual({
      from: 1,
      to: 9,
    });
    expect(coverageOf({})).toBeNull();
    expect(coverageOf({ coverage: { sections: [] } })).toBeNull();
  });

  it('prepares voters with corrections applied, leaving out rejected and deleted rows', () => {
    const result = prepareVoters([
      row(1),
      row(2, {}, { correctedValues: { name: 'Fixed Name', age: 41 } }),
      row(3, {}, { status: 'rejected' }),
      row(4, { marker: 'deleted' }),
      row(5, { marker: 'deleted' }, { correctedValues: { marker: null } }),
    ]);
    if (!result.ok) throw new Error(result.message);
    expect(result.voters.map((v) => v.rowId)).toEqual(['row-1', 'row-2', 'row-5']);
    expect(result.skipped).toEqual({ rejected: 1, deleted: 1 });
    expect(result.voters[1]).toMatchObject({
      epic: 'TST1000002',
      sectionNo: 1,
      serialNo: 2,
      sourceData: {
        name: 'Fixed Name',
        age: 41,
        corrected: ['age', 'name'],
        rawText: '2 synthetic',
      },
    });
    // Values that aren't part of the record (the printed serial, the EPIC) stay out of it.
    expect(result.voters[0]!.sourceData).not.toHaveProperty('epic');
    expect(result.voters[0]!.sourceData).not.toHaveProperty('printedSerial');
  });

  it('refuses rows with open errors or missing EPIC, section or serial', () => {
    const openError = row(
      1,
      {},
      {
        messages: [
          { code: 'field.missing', severity: 'error', message: 'x', field: 'rows[1].age' },
        ],
      },
    );
    const noEpic = row(2, { epic: null });
    const noSection = row(3, {}, { sectionNo: null });
    const result = prepareVoters([openError, noEpic, noSection, row(4)]);
    expect(result).toMatchObject({
      ok: false,
      code: 'rows.unresolved',
      rowIds: ['row-1', 'row-2', 'row-3'],
    });
    // A corrected field resolves its error; a corrected EPIC or section fills the gap.
    const fixed = prepareVoters([
      { ...openError, correctedValues: { age: 40 } },
      { ...noEpic, correctedValues: { epic: 'ABC1234567' } },
      { ...noSection, correctedValues: { sectionNumber: 2 } },
    ]);
    expect(fixed.ok).toBe(true);
  });

  it('refuses an EPIC or serial listed twice', () => {
    expect(prepareVoters([row(1), row(2, { epic: 'TST1000001' }), row(3)])).toMatchObject({
      ok: false,
      code: 'rows.duplicate_epic',
      rowIds: ['row-1', 'row-2'],
    });
    expect(prepareVoters([row(1), row(2, {}, { serialNo: 1 })])).toMatchObject({
      ok: false,
      code: 'rows.duplicate_serial',
    });
    // A rejected duplicate doesn't count.
    expect(prepareVoters([row(1), row(2, { epic: 'TST1000001' }, { status: 'rejected' })]).ok).toBe(
      true,
    );
  });
});
