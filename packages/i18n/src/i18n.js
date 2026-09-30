// Shared UI strings: loading, validation and the per-app outputs.
//
// locales/<locale>.json holds flat, dotted keys. `en` is the source: every key
// has an `@key` entry with a description for translators. Other locales hold
// the same keys (translations only). Keys starting with `mobile.` or `web.`
// belong to one app; every other group is shared by both.

import { readdir, readFile } from 'node:fs/promises';

export const BASE_LOCALE = 'en';
export const APP_NAMESPACES = ['mobile', 'web'];

/** Groups keyed by an API/enum code, so apps can look a label up by code. */
export const LOOKUP_GROUPS = {
  visitOutcome: 'visitOutcomeLabel',
  syncState: 'syncStateLabel',
  gender: 'genderLabel',
  error: 'errorMessage',
};

const KEY = /^[a-z][a-zA-Z0-9]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const PLACEHOLDER = /\{(\w+)\}/g;

/** Reads every locales/*.json into `{ [locale]: { key: value } }`, base first. */
export async function loadLocales(dir = new URL('../locales/', import.meta.url)) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const locales = {};
  for (const file of [`${BASE_LOCALE}.json`, ...files.filter((f) => f !== `${BASE_LOCALE}.json`)]) {
    locales[file.slice(0, -'.json'.length)] = JSON.parse(
      await readFile(new URL(file, dir), 'utf8'),
    );
  }
  return locales;
}

/** Message keys of a locale file, without the `@key` metadata entries. */
export const messageKeys = (messages) => Object.keys(messages).filter((k) => !k.startsWith('@'));

const placeholders = (text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

/**
 * Checks every locale against the base locale. Returns a list of problems;
 * an empty list means every key is translated in every locale.
 */
export function validate(locales) {
  const problems = [];
  const base = locales[BASE_LOCALE];
  if (!base) return [`missing ${BASE_LOCALE}.json`];
  const baseKeys = messageKeys(base);

  for (const key of baseKeys) {
    if (!KEY.test(key)) problems.push(`${BASE_LOCALE}: "${key}" is not a valid key`);
    if (!base[`@${key}`]?.description) {
      problems.push(`${BASE_LOCALE}: "${key}" has no "@${key}".description for translators`);
    }
  }
  for (const key of Object.keys(base).filter((k) => k.startsWith('@'))) {
    if (!(key.slice(1) in base)) problems.push(`${BASE_LOCALE}: "${key}" describes a missing key`);
  }

  for (const [locale, messages] of Object.entries(locales)) {
    for (const key of baseKeys) {
      const value = messages[key];
      if (typeof value !== 'string' || value.trim() === '') {
        problems.push(`${locale}: missing translation for "${key}"`);
      } else if (placeholders(value).join() !== placeholders(base[key]).join()) {
        problems.push(
          `${locale}: "${key}" must use the placeholders {${placeholders(base[key]).join('}, {')}}`,
        );
      }
    }
    if (locale === BASE_LOCALE) continue;
    for (const key of Object.keys(messages)) {
      if (key.startsWith('@'))
        problems.push(`${locale}: "${key}" belongs in ${BASE_LOCALE}.json only`);
      else if (!(key in base)) problems.push(`${locale}: "${key}" is not in ${BASE_LOCALE}.json`);
    }
  }

  const arbNames = new Map();
  for (const key of keysFor(base, 'mobile')) {
    const name = arbName(key);
    if (arbNames.has(name))
      problems.push(`"${key}" and "${arbNames.get(name)}" both become ${name}`);
    arbNames.set(name, key);
  }
  return problems;
}

/** Keys an app uses: its own namespace plus every shared group. */
export function keysFor(messages, app) {
  return messageKeys(messages).filter((key) => {
    const ns = key.split('.')[0];
    return ns === app || !APP_NAMESPACES.includes(ns);
  });
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "error.VALIDATION_FAILED" / "visitOutcome.no_one_available" segments.
const camelSegment = (segment) =>
  segment
    .split('_')
    .map((part) => capitalize(part === part.toUpperCase() ? part.toLowerCase() : part))
    .join('');

/**
 * The Flutter getter name for a key: the `mobile.` prefix is dropped and the
 * rest is camel-cased, e.g. `visitOutcome.no_one_available` →
 * `visitOutcomeNoOneAvailable`.
 */
export function arbName(key) {
  const parts = key.split('.');
  if (parts[0] === 'mobile') parts.shift();
  const joined = parts.map(camelSegment).join('');
  return joined.charAt(0).toLowerCase() + joined.slice(1);
}

/** ARB file content for Flutter's gen-l10n. Descriptions only in the base locale. */
export function toArb(locale, messages, base) {
  const arb = { '@@locale': locale };
  for (const key of keysFor(base, 'mobile')) {
    const name = arbName(key);
    arb[name] = messages[key];
    if (locale === BASE_LOCALE) {
      const meta = { description: base[`@${key}`].description };
      const names = placeholders(base[key]);
      if (names.length > 0) meta.placeholders = Object.fromEntries(names.map((n) => [n, {}]));
      arb[`@${name}`] = meta;
    }
  }
  return `${JSON.stringify(arb, null, 2)}\n`;
}

/** Flat `{ key: text }` for the admin web: shared keys plus `web.*` without the prefix. */
export function toWebMessages(messages, base) {
  return Object.fromEntries(
    keysFor(base, 'web').map((key) => [key.startsWith('web.') ? key.slice(4) : key, messages[key]]),
  );
}

/** Dart functions that turn an API/enum code into its label, e.g. errorMessage(l10n, code). */
export function toDartLookups(base) {
  const functions = Object.entries(LOOKUP_GROUPS).map(([group, fn]) => {
    const cases = messageKeys(base)
      .filter((key) => key.startsWith(`${group}.`))
      .map(
        (key) => `    case '${key.slice(group.length + 1)}':\n      return l10n.${arbName(key)};`,
      )
      .join('\n');
    return [
      `/// The label for a \`${group}\` code from the API, or null if it is unknown.`,
      `String? ${fn}(AppLocalizations l10n, String code) {`,
      '  switch (code) {',
      cases,
      '  }',
      '  return null;',
      '}',
    ].join('\n');
  });
  return [
    '// GENERATED FILE. Do not edit by hand.',
    '// Source: packages/i18n/locales/*.json',
    '// Regenerate: pnpm --filter @boothconnect/i18n build:mobile',
    '',
    "import 'generated/app_localizations.dart';",
    '',
    functions.join('\n\n'),
    '',
  ].join('\n');
}
