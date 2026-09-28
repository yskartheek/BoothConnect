// Turns tokens.json into Dart constants for the Flutter app
// (apps/mobile/lib/theme/tokens.g.dart). Pure and deterministic, and the output
// is already `dart format`-clean so the mobile CI format check passes.

import { parseColor } from './contrast.js';

const HEADER = `// GENERATED FILE. Do not edit by hand.
// Source: packages/design-tokens/tokens.json
// Regenerate: pnpm --filter @boothconnect/design-tokens build:dart
// ignore_for_file: public_member_api_docs`;

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

/** `#RRGGBB` / `rgba()` → `Color(0xAARRGGBB)`. */
export function dartColor(value) {
  const { r, g, b, a } = parseColor(value);
  return `Color(0x${hex2(Math.round(a * 255))}${hex2(r)}${hex2(g)}${hex2(b)})`;
}

// Numbers print without a trailing `.0`; Dart accepts int literals for doubles.
const num = (n) => String(n);

const PX = /^(-?\d+(?:\.\d+)?)(?:px)?$/;

/** Parses one CSS box-shadow layer: `x y blur spread color`. */
function parseShadowLayer(layer) {
  const match = /^(.*?)\s*(rgba\([^)]*\)|#[0-9a-f]{6})$/i.exec(layer.trim());
  if (!match) throw new Error(`Unsupported shadow: ${layer}`);
  const lengths = match[1].split(/\s+/).map((part) => {
    const m = PX.exec(part);
    if (!m) throw new Error(`Unsupported shadow length: ${part}`);
    return Number(m[1]);
  });
  const [x, y, blur = 0, spread = 0] = lengths;
  return { x, y, blur, spread, color: match[2] };
}

function boxShadows(css) {
  const layers = css.split(/,(?![^(]*\))/).map(parseShadowLayer);
  return layers
    .map(
      (s) =>
        `    BoxShadow(\n` +
        `      offset: Offset(${num(s.x)}, ${num(s.y)}),\n` +
        `      blurRadius: ${num(s.blur)},\n` +
        `      spreadRadius: ${num(s.spread)},\n` +
        `      color: ${dartColor(s.color)},\n` +
        `    ),`,
    )
    .join('\n');
}

function constClass(name, doc, members) {
  return `/// ${doc}\nabstract final class ${name} {\n${members.map((m) => `  ${m}`).join('\n')}\n}`;
}

function doubles(values) {
  return Object.entries(values).map(([k, v]) => `static const double ${k} = ${num(v)};`);
}

// Fields of BcThemeTokens: colour roles, glass, opaque glass and elevation.
function themeFields(theme) {
  const fields = [];
  for (const [k, v] of Object.entries(theme.color))
    fields.push({ name: k, type: 'Color', value: dartColor(v) });
  for (const [k, v] of Object.entries(theme.glass)) {
    fields.push({
      name: `glass${k[0].toUpperCase()}${k.slice(1)}`,
      type: 'Color',
      value: dartColor(v),
    });
  }
  for (const [k, v] of Object.entries(theme.reducedTransparency)) {
    fields.push({
      name: `opaque${k[0].toUpperCase()}${k.slice(1)}`,
      type: 'Color',
      value: dartColor(v),
    });
  }
  for (const [k, v] of Object.entries(theme.elevation)) {
    fields.push({
      name: `elevation${k[0].toUpperCase()}${k.slice(1)}`,
      type: 'List<BoxShadow>',
      value: `[\n${boxShadows(v)}\n  ]`,
    });
  }
  return fields;
}

function themeInstance(name, brightness, theme) {
  const args = themeFields(theme)
    .map((f) => `    ${f.name}: ${f.value.replace(/\n/g, '\n  ')},`)
    .join('\n');
  return `  static const ${name} = BcThemeTokens(\n    brightness: Brightness.${brightness},\n${args}\n  );`;
}

export function buildDart(tokens) {
  const { radius, spacing, touchTarget, typography, blur, motion, themes } = tokens;

  const fontFamily = Object.entries(typography.fontFamily).map(
    ([k, stack]) => `static const String ${k} = '${stack[0]}';`,
  );
  const fontWeight = Object.entries(typography.fontWeight).map(
    ([k, v]) => `static const FontWeight ${k} = FontWeight.w${v};`,
  );
  const textStyles = Object.entries(typography.style).map(
    ([k, s]) =>
      `static const TextStyle ${k} = TextStyle(\n` +
      `    fontFamily: BcFontFamily.${s.family},\n` +
      `    fontSize: ${num(s.size)},\n` +
      `    height: ${num(s.lineHeight)} / ${num(s.size)},\n` +
      `    fontWeight: BcFontWeight.${s.weight},\n` +
      `  );`,
  );
  const durations = Object.entries(motion.duration).map(
    ([k, v]) => `static const Duration ${k} = Duration(milliseconds: ${v});`,
  );
  durations.push(
    `static const Duration reducedMotion = Duration(milliseconds: ${motion.reducedMotion.duration});`,
  );
  const easings = Object.entries(motion.easing).map(
    ([k, v]) => `static const Cubic ${k} = Cubic(${v.map(num).join(', ')});`,
  );
  const springs = Object.entries(motion.spring).map(
    ([k, s]) =>
      `static const SpringDescription ${k} = SpringDescription(\n` +
      `    mass: ${num(s.mass)},\n` +
      `    stiffness: ${num(s.stiffness)},\n` +
      `    damping: ${num(s.damping)},\n` +
      `  );`,
  );

  const fields = themeFields(themes.light);
  const themeClass = [
    '/// Colours, glass and elevation for one theme. Use [light] or [dark].',
    'final class BcThemeTokens {',
    '  const BcThemeTokens({',
    '    required this.brightness,',
    ...fields.map((f) => `    required this.${f.name},`),
    '  });',
    '',
    '  final Brightness brightness;',
    ...fields.map((f) => `  final ${f.type} ${f.name};`),
    '',
    themeInstance('light', 'light', themes.light),
    '',
    themeInstance('dark', 'dark', themes.dark),
    '}',
  ].join('\n');

  return [
    HEADER,
    '',
    "import 'dart:ui' show Brightness;",
    '',
    "import 'package:flutter/animation.dart';",
    "import 'package:flutter/painting.dart';",
    "import 'package:flutter/physics.dart';",
    '',
    constClass('BcRadius', 'Corner radii in logical pixels.', doubles(radius)),
    '',
    constClass('BcSpacing', 'Spacing steps in logical pixels.', doubles(spacing)),
    '',
    constClass('BcTouchTarget', 'Minimum tap target size per platform.', doubles(touchTarget)),
    '',
    constClass(
      'BcFontFamily',
      'Primary font per role. The platform font is the fallback.',
      fontFamily,
    ),
    '',
    constClass('BcFontWeight', 'Font weights.', fontWeight),
    '',
    constClass('BcTextStyle', 'Named text styles (no colour).', textStyles),
    '',
    constClass('BcBlur', 'Backdrop blur sigma for glass surfaces.', doubles(blur)),
    '',
    constClass('BcDuration', 'Transition durations.', durations),
    '',
    constClass('BcEasing', 'Easing curves.', easings),
    '',
    constClass('BcSpring', 'Springs for sheets and card expansion.', springs),
    '',
    themeClass,
    '',
  ].join('\n');
}
