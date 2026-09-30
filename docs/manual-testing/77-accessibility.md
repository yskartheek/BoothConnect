# #77: Admin web accessibility pass

**Issue:** https://github.com/yskartheek/BoothConnect/issues/77
**What changed:**

- `apps/admin-web/e2e/accessibility.spec.ts` runs axe (WCAG 2.1 A and AA)
  on every Milestone 1 page in the light and the dark theme:
  - the sign-in steps (phone, code, a wrong code), the MFA step and the
    denied page;
  - Overview, Roll imports, Geography, Voters and households, Analytics,
    Users and assignments, and Audit and security;
  - the Appearance popover.

  A serious or critical violation fails the test, and so CI.

- The same spec walks the import wizard with the keyboard alone. Every Tab
  stop must show the focus ring:
  - choose the area and continue;
  - open the file chooser from the keyboard and upload;
  - move to extraction, filter the table and reach the review link;
  - open the confirm dialog (focus moves in), close it with Escape (focus
    comes back), and confirm.
- The extraction status is a live region. It now says the count too
  ("Files extracted: 2 of 2. Every file has finished."), because screen
  readers don't announce a changing label.
- The page specs from #71–#76 already run axe on their own states (dialogs,
  review, record, drawer).

## Steps

1. Start the API and the admin web as in the [#70 guide](70-admin-sign-in.md)
   (steps 1–4). Sign in as `+919999900001`.
2. Put the mouse aside. Press **Tab** from the top of the page.
   **Expect:**
   - "Skip to main content" appears first; **Enter** moves focus into the
     page;
   - every link, button and field shows a clear focus ring.
3. Open **Roll imports** from the keyboard (Tab to it, **Enter**). Choose
   your AC in **Your area** with the arrow keys, Tab to **Continue** and press
   **Enter**.
   **Expect:** the Upload step.
4. Tab until **Choose PDF or ZIP files** shows a focus ring, and press
   **Space**.
   **Expect:** the file chooser opens. Choose a synthetic test PDF (never a
   real roll), Tab to **Upload files (1)** and press **Enter**.
5. Tab to **Next: extraction** and press **Enter**. Turn on a screen reader
   (Narrator: **Win+Ctrl+Enter**).
   **Expect:** as extraction finishes, it reads "Files extracted: 1 of 1.
   Every file has finished."
6. If a file is ready, Tab to **Confirm all ready files**, press **Enter**,
   then **Escape**.
   **Expect:** the dialog closes and focus is back on the button.
7. Switch to the dark theme (**Appearance**, **Theme: Dark**) and repeat
   step 2 on a few pages.
   **Expect:** the focus ring and all text stay readable.
8. Run the tests:
   ```powershell
   pnpm --filter admin-web test
   pnpm --filter admin-web test:e2e
   ```
   **Expect:** all pass, including `accessibility.spec.ts`.

## Pass criteria

- Steps 1–8 give the expected results.

## Known issues and notes

- axe checks what it can compute. It doesn't replace a screen-reader pass
  (steps 5–6).
- Moderate and minor axe findings are not enforced.
