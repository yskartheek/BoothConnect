// Writes the Flutter app's ARB files and code-lookup helpers:
//   apps/mobile/lib/l10n/app_<locale>.arb
//   apps/mobile/lib/l10n/shared_labels.g.dart
//   pnpm --filter @boothconnect/i18n build:mobile   regenerate (then commit)
//   node scripts/build-mobile.js --check            exit 1 if they are out of date
import { readdir, readFile, writeFile } from 'node:fs/promises';

import { BASE_LOCALE, loadLocales, toArb, toDartLookups } from '../src/i18n.js';

const dir = new URL('../../../apps/mobile/lib/l10n/', import.meta.url);
const locales = await loadLocales();
const base = locales[BASE_LOCALE];

const files = new Map(
  Object.entries(locales).map(([locale, messages]) => [
    `app_${locale}.arb`,
    toArb(locale, messages, base),
  ]),
);
files.set('shared_labels.g.dart', toDartLookups(base));

if (process.argv.includes('--check')) {
  const stale = [];
  for (const [name, content] of files) {
    // Windows checkouts may have CRLF line endings; compare the text only.
    const current = await readFile(new URL(name, dir), 'utf8').catch(() => '');
    if (current.replace(/\r\n/g, '\n') !== content) stale.push(name);
  }
  // An ARB file for a locale that no longer exists in packages/i18n.
  for (const name of await readdir(dir)) {
    if (name.endsWith('.arb') && !files.has(name)) stale.push(`${name} (no matching locale)`);
  }
  if (stale.length > 0) {
    process.stderr.write(
      `Out of date in apps/mobile/lib/l10n: ${stale.join(', ')}.\n` +
        'Run `pnpm --filter @boothconnect/i18n build:mobile` and commit the result.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('Mobile ARB files are up to date.\n');
  }
} else {
  for (const [name, content] of files) await writeFile(new URL(name, dir), content);
  process.stdout.write(`Wrote ${[...files.keys()].join(', ')} to ${dir.pathname}\n`);
}
