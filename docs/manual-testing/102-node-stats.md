# #102: Analytics numbers for every area (node_stats)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/102
**What changed:**

- Every area, from State down to polling station, now has its numbers
  stored in a new table, `node_stats`:
  - voters by gender and age;
  - households, and very large households;
  - voters added and removed since the previous roll revision;
  - data quality (reading quality, corrected and rejected rows, duplicate
    EPICs, missing age or gender);
  - field work (households assigned and visited, visit outcomes, voters
    met).
- A parent area's numbers are always its children's added up. An AC shows
  the total of its parts, a PC the total of its ACs, and so on.
- The numbers update themselves:
  - right after an import is confirmed (#47);
  - within about 30 seconds of a visit being recorded;
  - only the affected area and the areas above it are recomputed.
- `pnpm --filter api stats:rebuild` recomputes everything. The first start
  on an empty database does this automatically.
- Nothing is shown to users yet: the analytics API with small-group
  suppression is #49, and the screens come later.
- The numbers only use what the roll prints (age, gender, house) and
  field-work status: never names, and nothing guessed from them.

## Steps

1. Prepare as usual (branch `claude/issue-102-node-stats`,
   `pnpm infra:up`, `pnpm --filter api db:deploy`,
   `pnpm --filter api db:seed`), then start the API:
   `pnpm --filter api dev`.
   **Expect:** within a few seconds, the numbers are built for the seed.
2. Open Prisma Studio (`pnpm --filter api exec prisma studio`), table
   `node_stats`.
   **Expect:** one row per area (8 for the seed). The row for part 1 has
   `metrics.electors.total` of at least 60. The row for AC 101 has the
   totals of parts 1 and 2 added together.
3. Record a visit as volunteer A (steps of the #41 guide), wait 30 seconds,
   and refresh Prisma Studio.
   **Expect:** station 1's `metrics.fieldWork.householdsVisited` went up by
   one, and so did the part's, AC's, PC's and State's.
4. Stop the API and run the full rebuild:
   ```powershell
   pnpm --filter api build
   pnpm --filter api stats:rebuild
   ```
   **Expect:** "node_stats rebuilt in … ms", and the same numbers as
   before.
5. Run the tests:
   ```powershell
   pnpm --filter api test; pnpm --filter api test:int
   ```
   **Expect:** all pass, including "analytics metrics" and "node_stats".
   They check:
   - the numbers against the seed;
   - that every parent equals its children plus its own counts;
   - that refreshing one part touches only it and the areas above it;
   - that a visit updates the field work;
   - that a new revision counts additions and deletions;
   - that a full rebuild matches the incremental refreshes.

## Pass criteria

- Steps 1–5 give the expected results.

## Known issues and notes

- New or ended volunteer assignments aren't followed yet. Run
  `stats:rebuild` after changing assignments, until assignment management
  requests a refresh itself.
- Auxiliary-station coverage changes (#101) will request a refresh when
  they are built.
