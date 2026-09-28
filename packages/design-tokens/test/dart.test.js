import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildDart, dartColor } from '../src/dart.js';

const tokens = JSON.parse(await readFile(new URL('../tokens.json', import.meta.url), 'utf8'));
const dart = buildDart(tokens);

test('the Dart build is repeatable', () => {
  assert.equal(buildDart(structuredClone(tokens)), dart);
});

test('colours become Color(0xAARRGGBB)', () => {
  assert.equal(dartColor('#2446B8'), 'Color(0xFF2446B8)');
  assert.equal(dartColor('rgba(255, 255, 255, 0.62)'), 'Color(0x9EFFFFFF)');
  assert.equal(dartColor('rgba(22, 27, 36, 0.68)'), 'Color(0xAD161B24)');
});

test('both themes are emitted with every colour, glass and opaque value', () => {
  for (const name of ['light', 'dark']) {
    const start = dart.indexOf(`static const ${name} = BcThemeTokens(`);
    assert.notEqual(start, -1, name);
    const body = dart.slice(start, dart.indexOf('\n  );', start));
    const theme = tokens.themes[name];
    assert.match(body, new RegExp(`brightness: Brightness\\.${name},`));
    assert.match(
      body,
      new RegExp(`\\btext: ${dartColor(theme.color.text).replace(/[()]/g, '\\$&')},`),
    );
    assert.match(
      body,
      new RegExp(`glassFill: ${dartColor(theme.glass.fill).replace(/[()]/g, '\\$&')},`),
    );
    assert.match(
      body,
      new RegExp(
        `opaqueFill: ${dartColor(theme.reducedTransparency.fill).replace(/[()]/g, '\\$&')},`,
      ),
    );
  }
});

test('shadows, motion and text styles are converted', () => {
  // "0 8px 18px -8px rgba(10, 16, 32, 0.28)"
  assert.match(
    dart,
    /offset: Offset\(0, 8\),\n\s+blurRadius: 18,\n\s+spreadRadius: -8,\n\s+color: Color\(0x470A1020\),/,
  );
  assert.match(dart, /static const Duration standard = Duration\(milliseconds: 220\);/);
  assert.match(dart, /static const Duration reducedMotion = Duration\(milliseconds: 0\);/);
  assert.match(dart, /static const Cubic standard = Cubic\(0\.2, 0, 0, 1\);/);
  assert.match(dart, /height: 24 \/ 16,/);
  assert.match(dart, /static const String ui = 'Figtree';/);
});

test('no line is longer than dart format allows', () => {
  const long = dart.split('\n').filter((line) => line.length > 80 && !line.startsWith('//'));
  assert.deepEqual(long, []);
});
