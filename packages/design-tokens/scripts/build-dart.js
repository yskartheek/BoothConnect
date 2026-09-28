// Writes apps/mobile/lib/theme/tokens.g.dart from tokens.json.
//   pnpm --filter @boothconnect/design-tokens build:dart   regenerate the file
//   node scripts/build-dart.js --check                     exit 1 if it is out of date
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { buildDart } from '../src/dart.js';

const tokens = JSON.parse(await readFile(new URL('../tokens.json', import.meta.url), 'utf8'));
const out = new URL('../../../apps/mobile/lib/theme/tokens.g.dart', import.meta.url);
const dart = buildDart(tokens);

if (process.argv.includes('--check')) {
  // Windows checkouts may have CRLF line endings; compare the text only.
  const current = (await readFile(out, 'utf8').catch(() => '')).replace(/\r\n/g, '\n');
  if (current !== dart) {
    process.stderr.write(
      `${out.pathname} is out of date.\n` +
        'Run `pnpm --filter @boothconnect/design-tokens build:dart` and commit the result.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('tokens.g.dart is up to date.\n');
  }
} else {
  await mkdir(new URL('.', out), { recursive: true });
  await writeFile(out, dart);
  process.stdout.write(`Wrote ${out.pathname}\n`);
}
