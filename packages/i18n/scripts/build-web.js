// Writes dist/web/<locale>.json for the admin web (shared keys + web.* keys).
// Run: pnpm --filter @boothconnect/i18n build
import { mkdir, writeFile } from 'node:fs/promises';

import { BASE_LOCALE, loadLocales, toWebMessages } from '../src/i18n.js';

const locales = await loadLocales();
const out = new URL('../dist/web/', import.meta.url);
await mkdir(out, { recursive: true });
for (const [locale, messages] of Object.entries(locales)) {
  const json = toWebMessages(messages, locales[BASE_LOCALE]);
  await writeFile(new URL(`${locale}.json`, out), `${JSON.stringify(json, null, 2)}\n`);
}
process.stdout.write(`Wrote ${Object.keys(locales).join(', ')} to ${out.pathname}\n`);
