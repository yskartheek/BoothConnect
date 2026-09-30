# #58: Mobile shared state widgets and sync status chip

**Issue:** https://github.com/yskartheek/BoothConnect/issues/58
**What changed:**

- Reusable screen states in `apps/mobile/lib/widgets/states.dart`:
  - **Loading** ("Loading…" with a spinner);
  - **Empty** ("Nothing here yet", or a heading the screen gives, with an
    optional button);
  - **Error** ("Something went wrong", the reason, **Try again**);
  - **Denied** ("No access", and who to ask);
  - **Offline** banner ("You're offline. Your changes stay on this phone
    and upload when you're back online.").
- A **sync status chip**:

  | Status   | Word         | Icon            |
  | -------- | ------------ | --------------- |
  | pending  | On phone     | phone           |
  | syncing  | Uploading    | arrows          |
  | synced   | Uploaded     | cloud with tick |
  | conflict | Choose value | split arrow     |
  | failed   | Not uploaded | error           |

  Each status has its own colour too, but the word and icon always carry it.
  The chip reads "Upload status: …" to screen readers.

- **Accessibility:**
  - loading, error and denied are announced when they appear, and headings
    are marked as headings;
  - tappable parts are at least 48dp;
  - the text meets contrast in both themes;
  - nothing overflows at 2× text on a small phone.
- All text is in English and Telugu.

No screen uses them yet: the households, visit and uploads screens (#62–#67)
will. So this issue is checked through the tests.

## Steps

1. Check out the branch and run the checks:
   ```powershell
   git checkout claude/issue-58-state-widgets
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. Run only this issue's tests, with their names:
   ```powershell
   cd apps/mobile
   flutter test test/widgets/states_test.dart --reporter expanded
   ```
   **Expect:** for both **light theme** and **dark theme**, a passing test for
   loading, empty, error, denied and offline, and for each of the five sync
   statuses. Also the tests for announcements, headings, Try again, the 48dp
   chip button and Telugu.

## Pass criteria

- Steps 1–2 pass.

## Known issues and notes

- These are widget tests, not golden (screenshot) tests. Golden images differ
  between Windows, macOS and Linux fonts, so they would fail on some machines.
- The offline banner goes at the top of a screen's scrolling content, so it
  scrolls away with the list rather than hiding it on a small phone with
  large text.
