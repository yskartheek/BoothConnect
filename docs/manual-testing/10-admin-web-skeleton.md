# #10: Next.js admin-web skeleton

**Issue:** https://github.com/yskartheek/BoothConnect/issues/10
**What changed:**

- New app `apps/admin-web` (`@boothconnect/admin-web`): Next.js 16 with the
  App Router, React 19 and TypeScript strict mode. The home page is a
  placeholder that says sign-in isn't available yet.
- Uses the shared `next` ESLint preset from #14
- Vitest with React Testing Library: a component test for the home-page panel
- Playwright: a smoke test that opens the home page in Chromium
- New root script `pnpm test:e2e` runs the browser tests of every app through
  Turborepo

You need Node 24 (see the #9 guide). The API doesn't need to run: the page
doesn't call it yet.

## Steps

1. Check out the branch and install:
   ```powershell
   git checkout claude/issue-10-admin-web-skeleton
   pnpm install --frozen-lockfile
   ```
2. Start the development server:
   ```powershell
   pnpm --filter admin-web dev
   ```
   **Expect:** `▲ Next.js 16...`, `Local: http://localhost:3000` and
   `✓ Ready`.
3. Open http://localhost:3000.
   **Expect:** a page titled **BoothConnect Admin** (also in the browser tab)
   with the text "Sign-in is not available yet. This is the admin portal
   skeleton." It follows your system's light or dark mode.
4. Optional: check hot reload. Change the default message in
   `apps/admin-web/components/welcome-panel.tsx` and save.
   **Expect:** the page updates without a manual refresh. Undo the change.
5. Stop the server (Ctrl+C) and run the component tests:
   ```powershell
   pnpm --filter admin-web test
   ```
   **Expect:** `Test Files  1 passed (1)` and `Tests  2 passed (2)`.
6. Download Playwright's Chromium (once, about 150 MB), then run the browser
   test:
   ```powershell
   pnpm --filter admin-web exec playwright install chromium
   pnpm --filter admin-web test:e2e
   ```
   **Expect:** `✓ ... home page loads` and `1 passed`. Playwright starts the
   dev server itself and stops it afterwards. If you left `dev` running, it
   reuses that server.
7. Optional: test the production build the way CI will:
   ```powershell
   $env:CI = "1"; pnpm --filter admin-web test:e2e; Remove-Item Env:CI
   ```
   **Expect:** a `next build` first, then `1 passed`.

## Pass criteria

- Steps 2, 3, 5 and 6 give the expected results.

## Known issues and notes

- **Port 3000 already in use?** Stop the other program, or run
  `pnpm --filter admin-web exec next dev --port 3001`. The Playwright test
  always uses port 3000.
- **`playwright install` is blocked on some corporate networks.** You can point
  the tests at an installed Chrome/Chromium instead:
  `$env:PLAYWRIGHT_CHROMIUM_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"`.
- **No styling yet.** The page uses system fonts and colours until the design
  tokens package (Epic 5) provides the theme.
- **`next-env.d.ts` is generated, not committed.** `pnpm typecheck` creates it
  with `next typegen` first.
