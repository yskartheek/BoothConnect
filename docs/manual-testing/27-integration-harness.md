# #27: API integration-test harness with real Postgres

**Issue:** https://github.com/yskartheek/BoothConnect/issues/27
**What changed:**

- `pnpm --filter api test:int` no longer uses your development database.
  Each run:
  1. creates a **template database** `boothconnect_it_template`, applies the
     migrations and loads the seed data into it;
  2. gives **every test file its own copy** (`boothconnect_it_<random>`),
     which takes about 100 ms, and drops it when the file finishes;
  3. removes the template, and any copies an interrupted run left behind.
- So every test file starts from the same seeded data, test files can run in
  parallel, and your own data in `boothconnect` is never changed.
- New helper `createTestApp()` (`apps/api/test/support/app.ts`) starts the
  full API against the test file's database, for tests that call endpoints.
  The health check test now uses it, and also checks it is on its own seeded
  database.
- CI no longer runs `db:deploy` before the integration tests, because the
  tests prepare their own databases.

## Steps

1. Check out the branch, install, and start the services:
   ```powershell
   git checkout claude/issue-27-integration-harness
   pnpm install --frozen-lockfile
   pnpm infra:up
   ```
2. Note how many rows your own database has (optional; any table works):
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "select count(*) from geography_node"
   ```
3. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** `Test Suites: 10 passed`, `Tests: 49 passed`, in about 15
   seconds. The tests don't need `db:deploy` or `db:seed` first.
4. Check that nothing was left behind:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "select datname from pg_database where datname like '%_it_%'"
   ```
   **Expect:** `(0 rows)`. Step 2's command again gives the same count as
   before.

## Pass criteria

- Step 3 passes and step 4 shows no leftover databases.

## Known issues and notes

- **Testcontainers isn't used.** The issue suggested starting Postgres with
  Testcontainers in CI; CI already runs a real Postgres 16 as a GitHub service
  container, which gives the same result without the extra dependency or
  start-up time. Locally the tests use the `pnpm infra:up` database server.
- **`loginAs(user)` comes with sign-in** (#30); it needs access tokens, which
  don't exist yet.
- The database user needs permission to create databases. The local Docker
  and CI users have it (they are the Postgres superuser).
- Redis is still shared between test files. Tests that use Redis (sign-in
  codes, #29) will use their own keys.
