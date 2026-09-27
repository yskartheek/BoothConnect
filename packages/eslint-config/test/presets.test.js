// Smoke tests: each preset loads and flags the rule it exists for.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const here = dirname(fileURLToPath(import.meta.url));

async function lint(preset, code, filePath, cwd = here) {
  const { default: config } = await import(`../${preset}.js`);
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId);
}

test('base flags loose equality and non-type imports of types', async () => {
  const rules = await lint(
    'base',
    "import { Foo } from './foo';\nexport const eq = (a: number, b: Foo) => a == Number(b);\n",
    join(here, 'sample.ts'),
  );
  assert.ok(rules.includes('eqeqeq'));
  assert.ok(rules.includes('@typescript-eslint/consistent-type-imports'));
});

test('base allows underscore-prefixed unused args', async () => {
  const rules = await lint(
    'base',
    'export const f = (_unused: number) => 1;\n',
    join(here, 'ok.ts'),
  );
  assert.deepEqual(rules, []);
});

test('nest flags floating promises with type information', async () => {
  const cwd = join(here, 'fixtures/nest');
  const { readFile } = await import('node:fs/promises');
  const filePath = join(cwd, 'service.ts');
  const rules = await lint('nest', await readFile(filePath, 'utf8'), filePath, cwd);
  assert.ok(rules.includes('@typescript-eslint/no-floating-promises'));
});

test('nest does not require type-only imports (keeps DI metadata)', async () => {
  const cwd = join(here, 'fixtures/nest');
  const rules = await lint(
    'nest',
    "import { save } from './service';\nexport const s = save;\n",
    join(cwd, 'service.ts'),
    cwd,
  );
  assert.ok(!rules.includes('@typescript-eslint/consistent-type-imports'));
});

test('next flags hook rule violations and <img>', async () => {
  const rules = await lint(
    'next',
    [
      "import { useState } from 'react';",
      'export function Page({ on }: { on: boolean }) {',
      '  if (on) { useState(0); }',
      '  return <img src="/a.png" alt="" />;',
      '}',
      '',
    ].join('\n'),
    join(here, 'page.tsx'),
  );
  assert.ok(rules.includes('react-hooks/rules-of-hooks'));
  assert.ok(rules.includes('@next/next/no-img-element'));
});
