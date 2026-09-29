# #51: Cross-booth authorization test suite

**Issue:** https://github.com/yskartheek/BoothConnect/issues/51
**What changed:**

- One test suite, `apps/api/test/cross-booth.int-spec.ts`, is the
  Milestone 1 authorization gate (plan §8). Volunteer A (station 1) tries
  every endpoint that is limited to booths against booth B (station 2):
  - geographies;
  - households: list, search, details, add, edit, add a member;
  - members: details, edit;
  - visits and conflict resolution;
  - sync: pull and push;
  - analytics.
- What it checks:
  - asking for a booth B record by its ID gives **404**;
  - lists, searches and the phone's sync download contain **nothing**
    from booth B;
  - every attempt to change booth B's data (directly or through sync push)
    is refused, and booth B's data is unchanged afterwards;
  - analytics are closed to volunteers. A campaign manager limited to
    booth A gets 404 for booth B and the areas above, and booth A's numbers
    count only booth A.
- **New endpoints can't slip through.** The suite lists every route the API
  serves and fails if one isn't classified in it. So adding an endpoint
  means adding it to this suite, with a cross-booth test when it is scoped.
- A pull-request template (`.github/pull_request_template.md`) now has
  this as a checklist item for reviewers.
- The suite runs in CI with the other integration tests.

## Steps

1. Prepare as usual (branch `claude/issue-51-cross-booth`,
   `pnpm infra:up`).
2. Run the suite:
   ```powershell
   pnpm --filter api test:int -- test/cross-booth.int-spec.ts
   ```
   **Expect:** 11 tests pass.
3. Optional, to see the gate work: in
   `apps/api/test/cross-booth.int-spec.ts`, delete the line
   `'GET /health': 'public',` and run step 2 again.
   **Expect:** the last test fails and names `GET /health` as
   unclassified. Undo the change afterwards.
4. Open a new pull request on GitHub (you can close it again).
   **Expect:** the description starts from the template, with the
   checklist.

## Pass criteria

- Steps 2–4 give the expected results.

## Known issues and notes

- Admin-only endpoints (imports, audit log) aren't limited to booths. The
  suite checks that volunteers get 403 for them. Their area limits for
  admins are tested in their own suites.
