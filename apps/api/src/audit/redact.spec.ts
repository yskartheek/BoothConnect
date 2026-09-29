import { REDACTED, redact } from './redact';

describe('redact', () => {
  it('redacts credentials and codes by key, in any spelling', () => {
    expect(
      redact({
        refresh_token: 'abc',
        accessToken: 'abc',
        'Refresh-Token': 'abc',
        Authorization: 'Bearer abc',
        code: '123456',
        otp: '123456',
        password: 'p',
      }),
    ).toEqual({
      refresh_token: REDACTED,
      accessToken: REDACTED,
      'Refresh-Token': REDACTED,
      Authorization: REDACTED,
      code: REDACTED,
      otp: REDACTED,
      password: REDACTED,
    });
  });

  it('redacts personal data by key, nested and in arrays', () => {
    expect(
      redact({
        member: { name: 'A Person', age: 40, epic_number: 'ABC1234567', gender: 'female' },
        households: [{ address: '1-2-3 Main Road', latitude: 17.4, reason: 'moved' }],
      }),
    ).toEqual({
      member: { name: REDACTED, age: REDACTED, epic_number: REDACTED, gender: REDACTED },
      households: [{ address: REDACTED, latitude: REDACTED, reason: 'moved' }],
    });
  });

  it('redacts phone numbers and tokens under innocent keys', () => {
    expect(
      redact({
        note: 'call +919876543210',
        other: 'call 9876543210 later',
        jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
        opaque: 'q8Zr0Vn3k2m9X1pL4sT7uY6wB5cD8eF0gH2jK3lM4nO',
      }),
    ).toEqual({ note: REDACTED, other: REDACTED, jwt: REDACTED, opaque: REDACTED });
  });

  it('keeps what the log needs: ids, codes, counts, flags', () => {
    const safe = {
      reason: 'OTP_INVALID',
      householdId: '0199a3c1-7f7a-7c3e-9b1e-2f8d3c4b5a61',
      fieldsChanged: 3,
      withConsent: true,
      nothing: null,
    };
    expect(redact(safe)).toEqual(safe);
  });

  it('keeps ids whose hex digits look like a phone number (#167)', () => {
    const ids = {
      // The last group starts with ten digits.
      importFileId: '43ff6220-fb18-47d2-b640-4330754093f1',
      allDigits: '12345678-1234-4234-8234-123456789012',
      upper: '43FF6220-FB18-47D2-B640-4330754093F1',
      path: 'imports/43ff6220-fb18-47d2-b640-4330754093f1/file.pdf',
    };
    expect(redact(ids)).toEqual(ids);
    // Still redacted: a phone number on its own, or in a sentence.
    expect(redact({ a: '9876543210', b: 'ring 9876543210.', c: 'x+919876543210' })).toEqual({
      a: REDACTED,
      b: REDACTED,
      c: REDACTED,
    });
  });

  it('does not modify its input', () => {
    const input = { phone: '+919876543210' };
    redact(input);
    expect(input).toEqual({ phone: '+919876543210' });
  });
});
