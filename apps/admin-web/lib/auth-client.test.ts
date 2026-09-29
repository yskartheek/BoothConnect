import { safeNext } from './auth-client';

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/users?role=admin')).toBe('/users?role=admin');
    expect(safeNext('/imports/abc')).toBe('/imports/abc');
  });

  it('sends anything else to the overview', () => {
    for (const next of [
      null,
      undefined,
      '',
      'users',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
    ]) {
      expect(safeNext(next)).toBe('/');
    }
  });
});
