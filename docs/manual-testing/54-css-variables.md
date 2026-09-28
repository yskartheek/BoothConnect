# #54: Design tokens as CSS variables in the admin web

**Issue:** https://github.com/yskartheek/BoothConnect/issues/54
**What changed:**

- `packages/design-tokens` now has a build step that turns `tokens.json` into
  `dist/tokens.css`: one CSS variable (`--bc-…`) per token. It has a light
  theme, a dark theme that follows Windows' light/dark setting, and
  `data-theme` switches that force one theme
- When **Transparency effects** are off (or the page asks for reduced
  transparency), glass surfaces become solid and lose their blur
- When **Animation effects** are off, every animation duration becomes 0
- The admin web home page now uses the tokens. The welcome card is a glass
  panel over a soft coloured background, and a new **Appearance** box lets you
  pick the theme and reduce transparency
- `pnpm --filter admin-web dev` builds the tokens first, so it works on a
  fresh checkout

## Steps

1. Check out the branch and install:
   ```powershell
   git checkout claude/issue-54-css-vars
   pnpm install --frozen-lockfile
   ```
2. Build the tokens and look at the output:
   ```powershell
   pnpm --filter @boothconnect/design-tokens build
   notepad packages\design-tokens\dist\tokens.css
   ```
   **Expect:** a `:root { … }` block with lines such as
   `--bc-color-text: #121A2B;`, then blocks for
   `@media (prefers-color-scheme: dark)`, `[data-theme='dark']`,
   `@media (prefers-reduced-transparency: reduce)` and
   `@media (prefers-reduced-motion: reduce)`.
3. Run the admin web:
   ```powershell
   pnpm --filter admin-web dev
   ```
   Open http://localhost:3000 in Chrome or Edge.
   **Expect:** "BoothConnect Admin" on a frosted-glass card over a pale blue and
   teal background, and an **Appearance** box below it.
4. Switch the theme with the page control. Set **Theme** to **Dark**.
   **Expect:** the page turns dark navy and the card becomes dark glass. Set it
   to **Light**, then back to **Same as system**.
5. Switch the theme from Windows. Go to **Settings → Personalization →
   Colors → Choose your mode → Dark** (Theme still set to **Same as
   system**).
   **Expect:** the page turns dark without reloading. Switch Windows back
   afterwards.
6. Reduce transparency with the page control. Tick **Reduce transparency**.
   **Expect:** the card becomes solid (no see-through, no blur). The colours
   behind it no longer show through. Untick it and the glass comes back.
7. Reduce transparency the way a user would. Either:
   - Windows: **Settings → Accessibility → Visual effects → Transparency
     effects → Off**, then reload the page, or
   - Chrome/Edge DevTools: press `F12`, then `Ctrl+Shift+P`, type
     **Rendering**, press Enter, and set **Emulate CSS media feature
     prefers-reduced-transparency** to `reduce`.

   **Expect:** the card turns solid, as in step 6, with the checkbox still
   unticked.

8. Optional: reduced motion. In the same DevTools **Rendering** panel, set
   **prefers-reduced-motion** to `reduce`. In the **Elements** tab select
   `<html>` and look at **Computed**: `--bc-duration-standard` is `0ms`
   (instead of `220ms`).
9. Run the automated checks:
   ```powershell
   pnpm --filter @boothconnect/design-tokens test
   pnpm --filter admin-web test
   pnpm test:e2e
   ```
   **Expect:** `# fail 0` for the tokens package, all Vitest tests pass, and
   Playwright reports `6 passed`. Before the first `test:e2e`, run
   `pnpm --filter admin-web exec playwright install chromium` once.

## Pass criteria

- Steps 4–7 visibly change the card: dark/light with the theme, solid with
  reduced transparency.
- Step 9 passes, and `git status` is clean afterwards (`dist/` is ignored).

## Known issues and notes

- **The Appearance box is a demo control.** Its choice isn't saved; a reload
  goes back to "Same as system". A saved preference can come with the real admin
  screens.
- **Firefox and Safari** don't support `prefers-reduced-transparency` yet, so
  on those browsers only the **Reduce transparency** checkbox works. Chrome and
  Edge follow the Windows setting.
- **Fonts aren't loaded yet.** The variables name Figtree and Bricolage
  Grotesque, but until the fonts are added the page falls back to Segoe UI.
- **`dist/tokens.css` is generated, not committed.** `pnpm build`,
  `pnpm test:e2e` and `pnpm --filter admin-web dev` create it. If you open the
  admin web some other way and see an error about `tokens.css`, run step 2.
- **Spring animations** in `tokens.json` have no CSS equivalent. Only the
  Flutter theme (#55) uses them.
