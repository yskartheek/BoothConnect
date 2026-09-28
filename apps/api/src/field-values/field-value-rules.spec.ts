import { displayAddress, isValidValue } from './field-value-rules';

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
    ['address', { house_no: '12/4', pin_code: '500038' }, true],
    ['address', { street: 'Gandhi Road' }, true],
    ['address', { area: 'Only area' }, false],
    ['address', { house_no: '1', pin_code: '5000' }, false],
    ['address', { house_no: '1', floor: '2' }, false],
    ['address', { house_no: '  ' }, false],
    ['address', 'H NO 1', false],
    ['location', { lat: 17.4, lng: 78.5, capturedAt: '2026-09-26T12:00:00Z' }, true],
    ['location', { lat: 17.4, lng: 78.5, accuracyM: 8, capturedAt: '2026-09-26T12:00:00Z' }, true],
    ['location', { lat: 91, lng: 78.5, capturedAt: '2026-09-26T12:00:00Z' }, false],
    ['location', { lat: 17.4, lng: 78.5, capturedAt: 'yesterday' }, false],
    ['location', { lat: 17.4, lng: 78.5, capturedAt: '2026-09-26T12:00:00Z', x: 1 }, false],
    ['location', { lat: 17.4, lng: 78.5 }, false],
  ] as const)('%s %j → %s', (type, value, expected) => {
    expect(isValidValue(type, options, value)).toBe(expected);
  });

  it('a select field without options accepts nothing', () => {
    expect(isValidValue('single_select', null, 'a')).toBe(false);
  });
});

describe('displayAddress', () => {
  it('joins house number, street, area and PIN; the landmark stays out', () => {
    expect(
      displayAddress({
        house_no: '12/4',
        street: 'Gandhi Road',
        area: 'Nehru Nagar',
        pin_code: '500038',
        landmark: 'Near water tank',
      }),
    ).toBe('12/4, Gandhi Road, Nehru Nagar, 500038');
    expect(displayAddress({ street: 'Gandhi Road' })).toBe('Gandhi Road');
  });
});
