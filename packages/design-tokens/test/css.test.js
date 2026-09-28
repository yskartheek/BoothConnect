import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildCss } from '../src/css.js';

const tokens = JSON.parse(await readFile(new URL('../tokens.json', import.meta.url), 'utf8'));
const css = buildCss(tokens);

// The declarations inside the first block that starts with `selector {`.
function blockOf(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing block: ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--bc-[\w-]+): ([^;]+);/g)].map(([, name, value]) => [name, value]),
  );
}

test('the build is repeatable: same tokens, same CSS', () => {
  assert.equal(buildCss(structuredClone(tokens)), css);
});

test(':root holds the light theme and the static tokens', () => {
  const root = blockOf(':root');
  assert.equal(root['--bc-color-text'], tokens.themes.light.color.text);
  assert.equal(root['--bc-color-text-muted'], tokens.themes.light.color.textMuted);
  assert.equal(root['--bc-radius-sheet'], '28px');
  assert.equal(root['--bc-space-xxl'], '48px');
  assert.equal(root['--bc-duration-standard'], '220ms');
  assert.equal(root['--bc-easing-standard'], 'cubic-bezier(0.2, 0, 0, 1)');
  assert.equal(root['--bc-text-body'], '400 16px/24px var(--bc-font-ui)');
  assert.equal(root['--bc-font-ui'], 'Figtree, "Segoe UI", system-ui, -apple-system, sans-serif');
});

test('the dark theme applies from the system setting and from data-theme', () => {
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme='light'\]\)/,
  );
  for (const selector of ["  :root:not([data-theme='light'])", "[data-theme='dark']"]) {
    const dark = blockOf(selector);
    for (const [key, value] of Object.entries(tokens.themes.dark.color)) {
      const name = `--bc-color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      assert.equal(dark[name], value, `${selector} ${name}`);
    }
    assert.equal(dark['--bc-glass-translucent-fill'], tokens.themes.dark.glass.fill);
  }
  assert.equal(blockOf("[data-theme='light']")['--bc-color-text'], tokens.themes.light.color.text);
});

test('reduced transparency swaps glass for the opaque surfaces and drops the blur', () => {
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  for (const selector of [
    '  :root,\n  [data-theme]',
    "[data-transparency='reduced'],\n[data-transparency='reduced'] [data-theme]",
  ]) {
    const reduced = blockOf(selector);
    assert.equal(reduced['--bc-glass-fill'], 'var(--bc-glass-opaque-fill)');
    assert.equal(reduced['--bc-glass-border'], 'var(--bc-glass-opaque-border)');
    assert.equal(reduced['--bc-glass-blur'], '0px');
  }
  const normal = blockOf(':root,\n[data-theme]');
  assert.equal(normal['--bc-glass-fill'], 'var(--bc-glass-translucent-fill)');
  assert.equal(normal['--bc-glass-blur'], 'var(--bc-blur-glass)');
});

test('reduced motion sets every duration to 0ms', () => {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.notEqual(start, -1);
  const body = css.slice(start);
  for (const key of Object.keys(tokens.motion.duration)) {
    assert.match(body, new RegExp(`--bc-duration-${key}: 0ms;`));
  }
});

test('both themes emit the same variable names', () => {
  const names = (selector) => Object.keys(blockOf(selector)).sort();
  assert.deepEqual(names("[data-theme='dark']"), names("[data-theme='light']"));
});
