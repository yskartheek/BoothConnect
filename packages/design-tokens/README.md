# @boothconnect/design-tokens

The single source for BoothConnect's look: colours, liquid-glass surfaces,
radius, spacing, typography, elevation and motion, for the light and dark
themes. Everything lives in [`tokens.json`](tokens.json). The web CSS
variables and the Flutter `ThemeData` (#55) are generated from it, so change
values here and nowhere else.

Values start from spec §11.1 ("Suggested design tokens") and the colours in
[`docs/design/volunteer-app-mockups.html`](../../docs/design/volunteer-app-mockups.html).

## What's in `tokens.json`

| Key                            | What it holds                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `radius`, `spacing`            | Logical pixels (px on web, dp/pt on mobile)                                                             |
| `touchTarget`                  | Minimum tap size: 44 on iOS, 48 on Android (spec §11.2)                                                 |
| `typography`                   | Font stacks, weights and named text styles (`display` … `caption`)                                      |
| `blur`                         | Backdrop blur radius for glass bars/cards and for sheets                                                |
| `motion`                       | Durations (150–300 ms), cubic-bezier easings, springs for sheets/cards; `reducedMotion.duration` is 0   |
| `themes.<light\|dark>.color`   | Named colour roles (`text`, `primary`, `onPrimary`, `successContainer` …)                               |
| `themes.*.glass`               | Translucent glass `fill`, `border` and `highlight`                                                      |
| `themes.*.reducedTransparency` | Opaque replacements for `glass`, used when the user turns on reduced transparency or the device is slow |
| `themes.*.elevation`           | Shadows (CSS `box-shadow` syntax)                                                                       |
| `contrast`                     | The foreground/background pairs the contrast check tests, and the backdrops glass is tested over        |

Colours are `#RRGGBB`, or `rgba(r, g, b, a)` for translucent tokens. Text
colours must be opaque.

## Contrast check

```sh
pnpm --filter @boothconnect/design-tokens check:contrast
```

Prints the WCAG contrast ratio for every pair in `contrast.pairs`, in both
themes, and exits with 1 if any pair is below its minimum: **4.5:1 for text**
(WCAG 1.4.3) and **3:1 for focus rings and control boundaries** (WCAG 1.4.11).
Glass is translucent, so a glass background is blended over every colour in
`contrast.backdrops` and the worst result counts. `pnpm test` runs the check,
so CI fails when a token change breaks contrast.

When you add a colour role, add it to `contrast.pairs` too.

## CSS variables (web)

```sh
pnpm --filter @boothconnect/design-tokens build   # writes dist/tokens.css
```

`dist/tokens.css` is generated (not committed); Turborepo builds it before any
app that depends on this package. Import it once, before the app's own CSS:

```ts
import '@boothconnect/design-tokens/tokens.css';
```

Every token becomes a `--bc-*` custom property, for example
`--bc-color-text`, `--bc-color-on-primary`, `--bc-radius-large`,
`--bc-space-md`, `--bc-elevation-medium`, `--bc-duration-standard` and
`--bc-easing-standard`. Text styles are `font` shorthands:
`font: var(--bc-text-body)`. Sizes are px and durations ms.

| What switches it                                                        | Effect                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Nothing                                                                 | Light theme                                                              |
| `prefers-color-scheme: dark`                                            | Dark theme, unless `<html data-theme="light">`                           |
| `data-theme="light"` / `"dark"` on `<html>` or any element              | Forces that theme for the element and everything inside it               |
| `prefers-reduced-transparency: reduce` or `data-transparency="reduced"` | `--bc-glass-*` switch to the opaque surfaces; `--bc-glass-blur` is `0px` |
| `prefers-reduced-motion: reduce`                                        | Every `--bc-duration-*` is `0ms`                                         |

Build glass surfaces from the `--bc-glass-*` variables only (`fill`, `border`,
`highlight`, `blur`, `sheet-blur`), never from `--bc-glass-translucent-*`, so
the reduced-transparency fallback applies:

```css
.card {
  background: var(--bc-glass-fill);
  border: 1px solid var(--bc-glass-border);
  box-shadow:
    inset 0 1px 0 var(--bc-glass-highlight),
    var(--bc-elevation-medium);
  backdrop-filter: blur(var(--bc-glass-blur));
}
```

Springs (`motion.spring`) have no CSS form and are only used by the Flutter theme.
