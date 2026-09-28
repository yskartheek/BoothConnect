// WCAG 2.2 contrast checks for the colour pairs listed in tokens.json.
// https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio

const HEX = /^#([0-9a-f]{6})$/i;
const RGBA = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0|1|0?\.\d+|1\.0+)\s*\)$/i;

/** Parses `#RRGGBB` or `rgba(r, g, b, a)` into `{ r, g, b, a }` (channels 0–255, alpha 0–1). */
export function parseColor(value) {
  const hex = HEX.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = RGBA.exec(value);
  if (rgba) {
    const [r, g, b] = rgba.slice(1, 4).map(Number);
    const a = Number(rgba[4]);
    if ([r, g, b].every((c) => c <= 255)) return { r, g, b, a };
  }
  throw new Error(`Not a #RRGGBB or rgba() colour: ${JSON.stringify(value)}`);
}

/** Paints a translucent colour over an opaque one. */
export function composite(top, bottom) {
  const mix = (t, b) => Math.round(t * top.a + b * (1 - top.a));
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function linear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(foreground, background) {
  const [hi, lo] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** Looks up a dotted path such as `color.text` inside a theme. */
export function resolve(theme, path) {
  const value = path.split('.').reduce((node, key) => node?.[key], theme);
  if (typeof value !== 'string') throw new Error(`Unknown colour token: ${path}`);
  return value;
}

/**
 * Checks every contrast pair in every theme. Returns one result per
 * (theme, foreground, background); `ratio` is the worst case across backdrops
 * when the background is translucent.
 */
export function checkContrast(tokens) {
  const { backdrops, pairs } = tokens.contrast;
  const results = [];
  for (const [themeName, theme] of Object.entries(tokens.themes)) {
    for (const pair of pairs) {
      for (const fgPath of pair.foreground) {
        const fg = parseColor(resolve(theme, fgPath));
        if (fg.a !== 1)
          throw new Error(`${themeName}.${fgPath} is translucent; text must be opaque`);
        for (const bgPath of pair.background) {
          const bg = parseColor(resolve(theme, bgPath));
          const candidates =
            bg.a === 1
              ? [{ over: null, color: bg }]
              : backdrops.map((over) => {
                  const under = parseColor(resolve(theme, over));
                  if (under.a !== 1) throw new Error(`${themeName}.${over} must be opaque`);
                  return { over, color: composite(bg, under) };
                });
          const worst = candidates
            .map(({ over, color }) => ({ over, ratio: contrastRatio(fg, color) }))
            .reduce((a, b) => (b.ratio < a.ratio ? b : a));
          results.push({
            theme: themeName,
            foreground: fgPath,
            background: bgPath,
            over: worst.over,
            ratio: worst.ratio,
            min: pair.min,
            pass: worst.ratio >= pair.min,
          });
        }
      }
    }
  }
  return results;
}
