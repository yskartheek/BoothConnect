# #53: Design tokens JSON (liquid glass light/dark + reduced transparency)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/53
**What changed:**

- New package `packages/design-tokens` (`@boothconnect/design-tokens`) with
  one file, `tokens.json`, holding colours, glass surfaces, blur, radius,
  spacing, typography, elevation and motion for the **light** and **dark**
  themes
- Each theme has an opaque `reducedTransparency` set that replaces the glass
  when the phone or browser asks for less transparency
- A contrast check that works out the WCAG contrast ratio of every
  text/background pair in both themes. It runs as part of `pnpm test`, so CI
  fails if a colour change makes text hard to read
- Nothing uses the tokens yet. The web CSS variables come in #54 and the
  Flutter theme in #55

## Steps

1. Check out the branch and install:
   ```powershell
   git checkout claude/issue-53-design-tokens
   pnpm install --frozen-lockfile
   ```
2. Run the contrast check:
   ```powershell
   pnpm --filter @boothconnect/design-tokens check:contrast
   ```
   **Expect:** one line per pair, each starting with `PASS`, for example
   `PASS  light  17.07:1 (min 4.5)  color.text on color.background`. The last
   line reads `112 of 112 pairs pass WCAG AA.`
3. Run the package tests:
   ```powershell
   pnpm --filter @boothconnect/design-tokens test
   ```
   **Expect:** the same table, then `# pass 9` and `# fail 0`.
4. Optional: see the check fail. Open `packages/design-tokens/tokens.json`,
   find `"textMuted": "#56627A"` in the `light` theme and change it to
   `"#9AA3B5"`. Run step 2 again.
   **Expect:** several `FAIL` lines for `color.textMuted`, and the command
   ends with an error. Undo the change afterwards:
   ```powershell
   git checkout -- packages/design-tokens/tokens.json
   ```
5. Optional: compare the colours with the mockups. Open
   `docs/design/volunteer-app-mockups.html` in a browser, switch between light
   and dark, and compare with the `themes` section of `tokens.json`.
6. Check the whole repo still passes:
   ```powershell
   pnpm format:check
   pnpm lint
   pnpm test
   ```

## Pass criteria

- Step 2 ends with `112 of 112 pairs pass WCAG AA.` and no `FAIL` lines.
- Steps 3 and 6 pass with no errors, and `git status` is clean afterwards.

## Known issues and notes

- **One mockup colour changed.** The light-theme amber accent was `#A76400`
  in the mockups. As text it only reached 4.2:1 on glass, below the 4.5:1
  minimum, so it is now a slightly darker `#9C5E00`. Every other colour is
  taken straight from the mockups.
- **New colours not in the mockups:** `primaryContainer`, `successContainer`,
  `warningContainer`, `dangerContainer` (the pale chip backgrounds, made
  opaque so they look the same on web and mobile), `border`, `focusRing`,
  `scrim`, and the dark theme's `onDanger`.
- **How glass is checked.** Glass is see-through, so its colour depends on
  what is behind it. The check blends the glass over the page background and
  the two backdrop tints, and uses the worst result. Glass over photos or maps
  is not covered, which is why the spec keeps data-heavy screens on opaque
  surfaces.
- **Fonts** (Bricolage Grotesque, Figtree, JetBrains Mono) are only named
  here. Loading them in the apps is part of #54 and #55. Each stack falls back
  to the system font.
- **Sizes have no unit.** They mean px on the web and dp/pt on phones;
  durations are milliseconds.
