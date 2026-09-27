# #16: Environment-variable template (.env.example)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/16
**What changed:**

- New `infra/env/.env.example`: every setting the local stack, the API and the
  admin web need, each with a comment and a local-only default. It covers
  PostgreSQL (`DATABASE_URL`), Redis (`REDIS_URL`), S3/MinIO, JWT secrets and
  lifetimes, `OTP_DEV_MODE=true` and `ANALYTICS_MIN_COHORT=10`.
- You copy it to `.env` in the **repository root**. `.env` and `.env.*` are
  git-ignored; only `.env.example` is committed.
- The `pnpm infra:*` scripts now run through `scripts/infra.mjs`, which passes
  the root `.env` to Docker Compose when it exists. Without a `.env`, the
  built-in defaults from #15 still apply.

Planned ports: API on **4000** (`http://localhost:4000/v1`), admin web on
**3000**. The apps themselves arrive in #9 and #10 and will read the same
`.env`.

## Steps

1. Check out the branch and install:
   ```powershell
   git checkout claude/issue-16-env-example
   pnpm install --frozen-lockfile
   ```
2. Create your `.env`:
   ```powershell
   Copy-Item infra/env/.env.example .env
   git status --short
   ```
   **Expect:** `git status` shows nothing for `.env` (it's ignored).
3. Open `.env` in an editor and read through it.
   **Expect:** every variable has a comment explaining it, and no value looks
   like a real password or key.
4. Start the services with the `.env` in place:
   ```powershell
   pnpm infra:up
   ```
   **Expect:** as in #15: all three services healthy, then
   `Bucket boothconnect-imports is ready`.
5. Check the `.env` is really used. Stop the services, change the Postgres
   port, and start again:
   ```powershell
   pnpm infra:down
   (Get-Content .env) -replace '^POSTGRES_PORT=5432', 'POSTGRES_PORT=5433' | Set-Content .env
   pnpm infra:up
   docker compose -f infra/docker-compose.yml ps
   ```
   **Expect:** the `postgres` line shows `0.0.0.0:5433->5432/tcp`.
6. Put it back and clean up:
   ```powershell
   pnpm infra:down
   Copy-Item infra/env/.env.example .env -Force
   ```

## Pass criteria

- Steps 2, 4 and 5 give the expected output.

## Known issues and notes

- **Keep related values in sync.** Some values repeat others, for example
  `DATABASE_URL` contains the Postgres user, password and port. If you change
  one, change the other. The comments point these out.
- **Changing Postgres or MinIO credentials** only takes effect on a fresh
  volume: run `pnpm infra:reset` (deletes local data), then `pnpm infra:up`.
- **Nothing reads the JWT, OTP, API or web values yet.** They're used from #9
  (API) and #10 (admin web) onwards, and by the auth work in #29–#33.
- **Variables set in your terminal win over `.env`.** If you set
  `$env:POSTGRES_PORT` while testing #15, close the terminal or run
  `Remove-Item Env:POSTGRES_PORT`.
