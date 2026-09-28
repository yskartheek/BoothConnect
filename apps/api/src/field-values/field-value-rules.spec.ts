import { isValidValue } from './field-value-rules';

const options = [
  { value: 'a', labelKey: 'x.a' },
  { value: 'b', labelKey: 'x.b' },
];

describe('isValidValue', () => {
  it.each([
    ['text', 'hello', true],
    ['text', '', false],
    ['text', 5, false],
    ['number', 0, true],
    ['number', Number.POSITIVE_INFINITY, false],
    ['number', '5', false],
    ['boolean', false, true],
    ['boolean', 'true', false],
    ['date', '2026-02-28', true],
    ['date', '2026-02-30', false],
    ['date', '28-02-2026', false],
    ['phone', '+919876543210', true],
    ['phone', '9876543210', false],
    ['single_select', 'a', true],
    ['single_select', 'c', false],
    ['multi_select', ['a', 'b'], true],
    ['multi_select', ['a', 'a'], false],
    ['multi_select', [], false],
    ['multi_select', ['c'], false],
  ] as const)('%s %j → %s', (type, value, expected) => {
    expect(isValidValue(type, options, value)).toBe(expected);
  });

  it('a select field without options accepts nothing', () => {
    expect(isValidValue('single_select', null, 'a')).toBe(false);
  });
});
