// Turns tokens.json into CSS custom properties (--bc-*). Pure and deterministic:
// the same tokens always give byte-identical CSS.

const PREFIX = '--bc';

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const px = (n) => `${n}px`;
const ms = (n) => `${n}ms`;

function fontStack(families) {
  return families.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');
}

function declarations(vars, indent) {
  return vars.map(([name, value]) => `${indent}${PREFIX}-${name}: ${value};`).join('\n');
}

function block(selector, vars, indent = '') {
  return `${indent}${selector} {\n${declarations(vars, `${indent}  `)}\n${indent}}`;
}

/** Tokens that are the same in every theme. */
function staticVars(tokens) {
  const { radius, spacing, touchTarget, typography, blur, motion } = tokens;
  const vars = [];
  for (const [k, v] of Object.entries(radius)) vars.push([`radius-${kebab(k)}`, px(v)]);
  for (const [k, v] of Object.entries(spacing)) vars.push([`space-${kebab(k)}`, px(v)]);
  for (const [k, v] of Object.entries(touchTarget)) vars.push([`touch-target-${kebab(k)}`, px(v)]);
  for (const [k, v] of Object.entries(typography.fontFamily)) {
    vars.push([`font-${kebab(k)}`, fontStack(v)]);
  }
  for (const [k, v] of Object.entries(typography.fontWeight)) {
    vars.push([`font-weight-${kebab(k)}`, String(v)]);
  }
  // `font: var(--bc-text-body)` sets weight, size, line height and family at once.
  for (const [k, s] of Object.entries(typography.style)) {
    const weight = typography.fontWeight[s.weight];
    vars.push([
      `text-${kebab(k)}`,
      `${weight} ${px(s.size)}/${px(s.lineHeight)} var(${PREFIX}-font-${kebab(s.family)})`,
    ]);
  }
  for (const [k, v] of Object.entries(blur)) vars.push([`blur-${kebab(k)}`, px(v)]);
  for (const [k, v] of Object.entries(motion.duration)) vars.push([`duration-${kebab(k)}`, ms(v)]);
  for (const [k, v] of Object.entries(motion.easing)) {
    vars.push([`easing-${kebab(k)}`, `cubic-bezier(${v.join(', ')})`]);
  }
  return vars;
}

/** Colours, glass and elevation for one theme. Glass comes in both variants. */
function themeVars(theme) {
  const vars = [];
  for (const [k, v] of Object.entries(theme.color)) vars.push([`color-${kebab(k)}`, v]);
  for (const [k, v] of Object.entries(theme.glass)) vars.push([`glass-translucent-${kebab(k)}`, v]);
  for (const [k, v] of Object.entries(theme.reducedTransparency)) {
    vars.push([`glass-opaque-${kebab(k)}`, v]);
  }
  for (const [k, v] of Object.entries(theme.elevation)) vars.push([`elevation-${kebab(k)}`, v]);
  return vars;
}

// The public glass variables point at one variant. They are re-declared on
// every [data-theme] element so a nested theme picks up its own colours.
function glassVars(tokens, variant) {
  const keys = Object.keys(tokens.themes.light.glass);
  const vars = keys.map((k) => [
    `glass-${kebab(k)}`,
    `var(${PREFIX}-glass-${variant}-${kebab(k)})`,
  ]);
  vars.push(['glass-blur', variant === 'opaque' ? '0px' : `var(${PREFIX}-blur-glass)`]);
  vars.push(['glass-sheet-blur', variant === 'opaque' ? '0px' : `var(${PREFIX}-blur-sheet)`]);
  return vars;
}

const withScheme = (css, scheme) => css.replace(/\n(\s*)}$/, `\n$1  color-scheme: ${scheme};\n$1}`);

export function buildCss(tokens) {
  const { light, dark } = tokens.themes;
  const reducedMotion = Object.keys(tokens.motion.duration).map((k) => [
    `duration-${kebab(k)}`,
    ms(tokens.motion.reducedMotion.duration),
  ]);

  return [
    '/* Generated from packages/design-tokens/tokens.json by scripts/build-css.js. Do not edit. */',
    '',
    '/* Light theme is the default. */',
    withScheme(block(':root', [...staticVars(tokens), ...themeVars(light)]), 'light'),
    '',
    '/* Dark theme: follows the system unless the page forces light with data-theme="light". */',
    '@media (prefers-color-scheme: dark) {',
    withScheme(block(":root:not([data-theme='light'])", themeVars(dark), '  '), 'dark'),
    '}',
    '',
    '/* Forced themes: data-theme on <html> or on any element. */',
    withScheme(block("[data-theme='light']", themeVars(light)), 'light'),
    '',
    withScheme(block("[data-theme='dark']", themeVars(dark)), 'dark'),
    '',
    '/* Glass surfaces: translucent and blurred by default. */',
    block(':root,\n[data-theme]', glassVars(tokens, 'translucent')),
    '',
    '/* Reduced transparency: opaque surfaces and no blur, from the system setting or data-transparency="reduced". */',
    '@media (prefers-reduced-transparency: reduce) {',
    block(':root,\n  [data-theme]', glassVars(tokens, 'opaque'), '  '),
    '}',
    '',
    block(
      "[data-transparency='reduced'],\n[data-transparency='reduced'] [data-theme]",
      glassVars(tokens, 'opaque'),
    ),
    '',
    '/* Reduced motion: transitions finish instantly. */',
    '@media (prefers-reduced-motion: reduce) {',
    block(':root', reducedMotion, '  '),
    '}',
    '',
  ].join('\n');
}
