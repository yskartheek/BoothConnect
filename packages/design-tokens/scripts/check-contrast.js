// Prints the contrast ratio of every pair in tokens.json and exits with 1 if
// any pair is below its WCAG AA minimum. Run: pnpm --filter @boothconnect/design-tokens check:contrast
import { readFile } from 'node:fs/promises';

import { checkContrast } from '../src/contrast.js';

const tokens = JSON.parse(await readFile(new URL('../tokens.json', import.meta.url), 'utf8'));
const results = checkContrast(tokens);

for (const r of results) {
  const over = r.over ? ` (over ${r.over})` : '';
  const status = r.pass ? 'PASS' : 'FAIL';
  process.stdout.write(
    `${status}  ${r.theme.padEnd(5)}  ${r.ratio.toFixed(2).padStart(5)}:1 (min ${r.min})  ` +
      `${r.foreground} on ${r.background}${over}\n`,
  );
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(
  `\n${results.length - failed.length} of ${results.length} pairs pass WCAG AA.\n`,
);
if (failed.length > 0) process.exitCode = 1;
