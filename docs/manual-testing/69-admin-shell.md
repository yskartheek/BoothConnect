# #69: Admin web shell (layout, navigation, theme, shared states)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/69
**What changed:**

- The admin portal has a side navigation (spec §9.3), a top bar and a page
  area.
  - Milestone 1 pages are links; their screens come in later issues and
    show "Not ready yet" for now.
  - Later pages are listed with a "Later" label and can't be opened.
- The top bar's **Appearance** button sets the theme (system, light or
  dark) and "Reduce transparency". The choice is remembered in the browser.
- Behind the scenes, for the pages to come:
  - TanStack Query and a wrapper around the typed API client, which handles
    error codes and an ended session;
  - shared loading, empty, error and denied states.
- The new texts are in English and Telugu.

## Steps

1. From the repository root:
   ```powershell
   pnpm install
   pnpm --filter admin-web dev
   ```
   Open http://localhost:3000. Since #70 the portal needs sign-in: start
   the API too and sign in as the seed admin, as in the
   [#70 guide](70-admin-sign-in.md).
2. **Expect:** the page title is "Overview · BoothConnect Admin". The side
   navigation shows:
   - Overview, Geography, Voters and households, Field operations (Later);
   - under **Data**: Analytics, Roll imports, Campaigns (Later);
   - under **Admin**: Users and assignments, Form configuration (Later),
     Privacy and consent (Later), Audit and security, Settings (Later).

   "Overview" is highlighted, and the page says "Not ready yet".

3. Click **Roll imports**, then the other enabled items.
   **Expect:** each opens its page, its heading matches, and it is the
   highlighted item. The "Later" items can't be clicked.
4. Reload the page, then press **Tab** once.
   **Expect:** "Skip to main content" appears at the top left. Press
   **Enter**; focus moves to the page, past the navigation.
5. Click **Appearance**, choose **Dark**, and tick **Reduce
   transparency**.
   **Expect:** the portal turns dark and the navigation panel becomes solid.
6. Reload the page.
   **Expect:** it opens dark and solid straight away, without a light
   flash. Choose **Same as system** and untick the box to go back.
7. Run the tests:
   ```powershell
   pnpm --filter admin-web test
   pnpm --filter admin-web exec playwright install chromium
   pnpm --filter admin-web test:e2e
   ```
   **Expect:** 26 component tests and 11 browser tests pass.

## Pass criteria

- Steps 2–7 give the expected results.

## Known issues and notes

- The pages themselves come with #71–#76, #103 and #176.
- The language is English only; a switch comes with admin settings.
