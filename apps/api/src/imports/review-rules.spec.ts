import {
  countVoters,
  currentValues,
  fieldOf,
  hasOpenError,
  normaliseMessages,
  printedCounts,
  REJECTED_CODE,
  revalidate,
  type RowMessage,
  rowStatus,
  totalsCheck,
} from './review-rules';

const message = (field: string | null, severity: RowMessage['severity'] = 'warning') => ({
  code: 'field.low_confidence',
  severity,
  message: 'low confidence',
  field,
});

describe('review rules', () => {
  it('maps extraction paths to field names', () => {
    expect(fieldOf('rows[12].relation_type')).toBe('relationType');
    expect(fieldOf('rows[3].section_number')).toBe('sectionNumber');
    expect(fieldOf('rows[3].serial')).toBe('printedSerial');
    expect(fieldOf('rows[3].age')).toBe('age');
    expect(fieldOf('epic')).toBe('epic');
    expect(fieldOf(null)).toBeNull();
    expect(normaliseMessages([message('rows[1].house_number')])[0]!.field).toBe('houseNumber');
    expect(normaliseMessages('not a list')).toEqual([]);
  });

  it('corrections go on top of the extracted values', () => {
    expect(currentValues({ name: 'A', age: 30 }, 2, { age: 31 })).toEqual({
      name: 'A',
      age: 31,
      sectionNumber: 2,
    });
    expect(currentValues({ name: 'A' }, null, null)).toEqual({ name: 'A', sectionNumber: null });
  });

  it('a correction resolves the messages about its field, and only those', () => {
    const stored = normaliseMessages([
      message('rows[1].age', 'error'),
      message('rows[1].name'),
      message(null),
    ]);
    const next = revalidate(stored, { age: 40 }, null, []);
    expect(next.map((m) => [m.field, m.resolved ?? false])).toEqual([
      ['age', true],
      ['name', false],
      [null, false],
    ]);
    expect(rowStatus(next)).toBe('warning');
    expect(hasOpenError('warning', next)).toBe(false);
    // Taking the correction back re-opens the message.
    const undone = revalidate(next, null, null, []);
    expect(undone[0]!.resolved).toBeUndefined();
    expect(hasOpenError('warning', undone)).toBe(true);
  });

  it('a row with every message resolved is accepted', () => {
    const stored = normaliseMessages([message('rows[1].age', 'error')]);
    expect(rowStatus(revalidate(stored, { age: 40 }, null, []))).toBe('accepted');
    expect(rowStatus([])).toBe('accepted');
  });

  it('rejecting keeps the reason; un-rejecting drops it; review messages are replaced', () => {
    const added: RowMessage = {
      code: 'epic.duplicate',
      severity: 'warning',
      message: 'dup',
      field: 'epic',
      source: 'review',
    };
    const rejected = revalidate([], { epic: 'ABC1234567' }, { reason: 'Not on the roll' }, [added]);
    expect(rowStatus(rejected)).toBe('rejected');
    expect(rejected.find((m) => m.code === REJECTED_CODE)?.message).toBe('Not on the roll');
    expect(hasOpenError('rejected', [message('age', 'error')])).toBe(false);
    const back = revalidate(rejected, { epic: 'ABC1234567' }, null, []);
    expect(back).toEqual([]);
    expect(rowStatus(back)).toBe('accepted');
  });

  it('counts voters without rejected rows or entries marked deleted', () => {
    const counts = countVoters([
      { status: 'accepted', current: { gender: 'male', marker: null } },
      { status: 'warning', current: { gender: 'female', marker: 'modified' } },
      { status: 'accepted', current: { gender: 'third_gender' } },
      { status: 'rejected', current: { gender: 'male' } },
      { status: 'accepted', current: { gender: 'female', marker: 'deleted' } },
    ]);
    expect(counts).toEqual({ male: 1, female: 1, thirdGender: 1, total: 3 });
  });

  it('the totals check compares with the printed totals', () => {
    const printed = printedCounts({
      startSerial: 1,
      endSerial: 3,
      counts: { male: 2, female: 1, thirdGender: 0, total: 3 },
    });
    expect(printed).toEqual({ male: 2, female: 1, thirdGender: 0, total: 3 });
    const off = totalsCheck(printed, null, { male: 1, female: 1, thirdGender: 0, total: 2 });
    expect(off).toMatchObject({
      matches: false,
      difference: { male: -1, female: 0, thirdGender: 0, total: -1 },
    });
    expect(totalsCheck(printed, null, printed!).matches).toBe(true);
    // Unreadable printed totals never match.
    expect(printedCounts({ counts: { male: 1, female: null, thirdGender: 0, total: 1 } })).toBe(
      null,
    );
    expect(printedCounts(null)).toBeNull();
    expect(totalsCheck(null, null, printed!)).toMatchObject({ matches: false, difference: null });
  });
});
