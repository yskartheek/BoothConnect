// Writes dist/tokens.css from tokens.json. Run: pnpm --filter @boothconnect/design-tokens build
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { buildCss } from '../src/css.js';

const tokens = JSON.parse(await readFile(new URL('../tokens.json', import.meta.url), 'utf8'));
const out = new URL('../dist/tokens.css', import.meta.url);

await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, buildCss(tokens));
process.stdout.write(`Wrote ${out.pathname}\n`);
