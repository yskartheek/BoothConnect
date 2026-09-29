import en from '@boothconnect/i18n/web/en.json';
import te from '@boothconnect/i18n/web/te.json';

import { t } from './i18n';

describe('t', () => {
  it('reads shared keys from packages/i18n', () => {
    expect(t('syncState.pending')).toBe('On phone');
    expect(t('visitOutcome.no_one_available')).toBe('No one home');
    expect(t('error.FORBIDDEN')).toBe("You don't have permission to see or change this.");
  });

  it('reads the admin web keys without the web. prefix', () => {
    expect(t('appTitle')).toBe('BoothConnect Admin');
    expect(t('appearance.reduceTransparency')).toBe('Reduce transparency');
  });

  it('fills {placeholders}', () => {
    expect(t('state.reference', { requestId: 'r-9' })).toBe('Reference: r-9');
    expect(t('state.reference')).toBe('Reference: {requestId}');
  });

  it('gets the same keys in Telugu, and no mobile-only keys', () => {
    expect(Object.keys(te).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).some((key) => key.startsWith('mobile.'))).toBe(false);
  });
});
