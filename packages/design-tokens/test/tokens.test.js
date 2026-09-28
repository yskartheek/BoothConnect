import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { checkContrast, composite, contrastRatio, parseColor } from '../src/contrast.js';

const tokens = JSON.parse(await readFile(new URL('../tokens.json', import.meta.url), 'utf8'));

// Every key path under an object, e.g. `color.text`.
function paths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? paths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

test('every text/background pair meets WCAG AA in both themes', () => {
  const failures = checkContrast(tokens)
    .filter((r) => !r.pass)
    .map((r) => `${r.theme}: ${r.foreground} on ${r.background} is ${r.ratio.toFixed(2)}:1`);
  assert.deepEqual(failures, []);
});

test('the check covers both themes, glass and the reduced-transparency fill', () => {
  const results = checkContrast(tokens);
  assert.deepEqual([...new Set(results.map((r) => r.theme))], ['light', 'dark']);
  for (const background of ['glass.fill', 'reducedTransparency.fill']) {
    assert.ok(results.some((r) => r.background === background && r.foreground === 'color.text'));
  }
});

test('light and dark define exactly the same tokens', () => {
  assert.deepEqual(paths(tokens.themes.dark), paths(tokens.themes.light));
});

test('every theme colour parses and reduced-transparency surfaces are opaque', () => {
  for (const [name, theme] of Object.entries(tokens.themes)) {
    for (const group of ['color', 'glass', 'reducedTransparency']) {
      for (const [key, value] of Object.entries(theme[group])) {
        assert.doesNotThrow(() => parseColor(value), `${name}.${group}.${key}`);
      }
    }
    for (const [key, value] of Object.entries(theme.reducedTransparency)) {
      assert.equal(parseColor(value).a, 1, `${name}.reducedTransparency.${key} must be opaque`);
    }
  }
});

test('glass tokens keep the spec §11.1 starting values', () => {
  assert.equal(tokens.themes.light.glass.fill, 'rgba(255, 255, 255, 0.62)');
  assert.equal(tokens.themes.dark.glass.fill, 'rgba(22, 27, 36, 0.68)');
  assert.deepEqual(tokens.radius, { small: 12, medium: 18, large: 24, sheet: 28, pill: 999 });
  assert.deepEqual(Object.values(tokens.spacing), [4, 8, 12, 16, 24, 32, 48]);
});

test('motion stays within 150–300 ms and reduced motion disables it', () => {
  for (const ms of Object.values(tokens.motion.duration)) assert.ok(ms >= 150 && ms <= 300);
  assert.equal(tokens.motion.reducedMotion.duration, 0);
});

test('contrast maths matches known WCAG values', () => {
  const white = parseColor('#FFFFFF');
  assert.equal(contrastRatio(parseColor('#000000'), white), 21);
  assert.equal(contrastRatio(white, white), 1);
  assert.equal(contrastRatio(parseColor('#767676'), white).toFixed(2), '4.54');
  assert.deepEqual(composite(parseColor('rgba(0, 0, 0, 0.5)'), white), {
    r: 128,
    g: 128,
    b: 128,
    a: 1,
  });
});

test('a low-contrast pair fails, judged over its worst backdrop', () => {
  const theme = {
    color: { text: '#777777', bg: '#FFFFFF', dark: '#000000' },
    glass: { fill: 'rgba(255, 255, 255, 0.5)' },
  };
  const [plain, glass] = checkContrast({
    themes: { t: theme },
    contrast: {
      backdrops: ['color.bg', 'color.dark'],
      pairs: [{ foreground: ['color.text'], background: ['color.bg', 'glass.fill'], min: 4.5 }],
    },
  });
  assert.equal(plain.pass, false);
  assert.equal(glass.over, 'color.dark');
  assert.equal(glass.pass, false);
});

test('bad colour values and unknown paths are rejected', () => {
  assert.throws(() => parseColor('blue'));
  assert.throws(() => parseColor('rgba(300, 0, 0, 1)'));
  assert.throws(() =>
    checkContrast({
      themes: { t: { color: {} } },
      contrast: { backdrops: [], pairs: [{ foreground: ['color.x'], background: [], min: 3 }] },
    }),
  );
});
