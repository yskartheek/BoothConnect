// Fails when any locale is missing a key, has an extra key or an empty value,
// or uses different {placeholders} than English.
// Run: pnpm --filter @boothconnect/i18n check
import { loadLocales, messageKeys, validate } from '../src/i18n.js';

const locales = await loadLocales();
const problems = validate(locales);
for (const problem of problems) process.stderr.write(`✖ ${problem}\n`);
const summary = Object.entries(locales)
  .map(([locale, messages]) => `${locale} (${messageKeys(messages).length})`)
  .join(', ');
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} translation problem(s) in ${summary}.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`All keys translated: ${summary}.\n`);
}
