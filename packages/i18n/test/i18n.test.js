import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arbName,
  keysFor,
  loadLocales,
  toArb,
  toDartLookups,
  toWebMessages,
  validate,
} from '../src/i18n.js';

const locales = await loadLocales();
const { en } = locales;

// A tiny valid pair of locales to break in each test.
function sample() {
  return {
    en: {
      'syncState.pending': 'On phone',
      '@syncState.pending': { description: 'd' },
      'error.RATE_LIMITED': 'Wait {seconds} seconds',
      '@error.RATE_LIMITED': { description: 'd' },
      'mobile.appTitle': 'BoothConnect',
      '@mobile.appTitle': { description: 'd' },
    },
    te: {
      'syncState.pending': 'ఫోన్‌లో ఉంది',
      'error.RATE_LIMITED': '{seconds} సెకన్లు ఆగండి',
      'mobile.appTitle': 'BoothConnect',
    },
  };
}

test('every key is translated in every locale', () => {
  assert.deepEqual(validate(locales), []);
  assert.deepEqual(Object.keys(locales), ['en', 'te']);
});

test('shared groups cover visit outcomes, sync states, error codes, consent and gender', () => {
  const groups = new Set(
    Object.keys(en)
      .filter((k) => !k.startsWith('@'))
      .map((k) => k.split('.')[0]),
  );
  for (const group of [
    'visitOutcome',
    'syncState',
    'error',
    'consent',
    'gender',
    'mobile',
    'web',
  ]) {
    assert.ok(groups.has(group), group);
  }
});

test('a missing translation is reported', () => {
  const l = sample();
  delete l.te['syncState.pending'];
  assert.deepEqual(validate(l), ['te: missing translation for "syncState.pending"']);
});

test('empty values, extra keys and te-only metadata are reported', () => {
  const l = sample();
  l.te['syncState.pending'] = '  ';
  l.te['syncState.extra'] = 'x';
  l.te['@mobile.appTitle'] = { description: 'x' };
  assert.deepEqual(validate(l), [
    'te: missing translation for "syncState.pending"',
    'te: "syncState.extra" is not in en.json',
    'te: "@mobile.appTitle" belongs in en.json only',
  ]);
});

test('placeholders must match English', () => {
  const l = sample();
  l.te['error.RATE_LIMITED'] = '{secs} సెకన్లు ఆగండి';
  assert.deepEqual(validate(l), ['te: "error.RATE_LIMITED" must use the placeholders {seconds}']);
});

test('English keys need a description and a valid name', () => {
  const l = sample();
  delete l.en['@syncState.pending'];
  l.en['Bad Key'] = 'x';
  l.en['@Bad Key'] = { description: 'd' };
  l.te['Bad Key'] = 'x';
  assert.deepEqual(validate(l), [
    'en: "syncState.pending" has no "@syncState.pending".description for translators',
    'en: "Bad Key" is not a valid key',
  ]);
});

test('keys become Flutter getter names', () => {
  assert.equal(arbName('mobile.homeWelcome'), 'homeWelcome');
  assert.equal(arbName('visitOutcome.no_one_available'), 'visitOutcomeNoOneAvailable');
  assert.equal(arbName('error.VALIDATION_FAILED'), 'errorValidationFailed');
  assert.equal(arbName('consent.caste.agree'), 'consentCasteAgree');
});

test('each app gets the shared keys plus only its own namespace', () => {
  const mobile = keysFor(en, 'mobile');
  assert.ok(mobile.includes('mobile.appTitle') && mobile.includes('syncState.pending'));
  assert.ok(!mobile.some((k) => k.startsWith('web.')));

  const web = toWebMessages(en, en);
  assert.equal(web.appTitle, 'BoothConnect Admin');
  assert.equal(web['syncState.pending'], 'On phone');
  assert.ok(!Object.keys(web).some((k) => k.startsWith('mobile.') || k.startsWith('web.')));
});

test('ARB files carry descriptions and placeholders in English only', () => {
  const l = sample();
  const arbEn = JSON.parse(toArb('en', l.en, l.en));
  assert.equal(arbEn['@@locale'], 'en');
  assert.equal(arbEn.appTitle, 'BoothConnect');
  assert.deepEqual(arbEn['@errorRateLimited'], { description: 'd', placeholders: { seconds: {} } });

  const arbTe = JSON.parse(toArb('te', l.te, l.en));
  assert.equal(arbTe.syncStatePending, 'ఫోన్‌లో ఉంది');
  assert.equal(arbTe['@syncStatePending'], undefined);
});

test('Dart lookups map every code in a group to its getter', () => {
  const dart = toDartLookups(en);
  assert.match(dart, /String\? visitOutcomeLabel\(AppLocalizations l10n, String code\)/);
  assert.match(dart, /case 'no_one_available':\n {6}return l10n\.visitOutcomeNoOneAvailable;/);
  assert.match(dart, /case 'UNAUTHENTICATED':\n {6}return l10n\.errorUnauthenticated;/);
  assert.ok(dart.split('\n').every((line) => line.length <= 80));
});
