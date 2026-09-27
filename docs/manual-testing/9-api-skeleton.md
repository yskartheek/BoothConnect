# #9: NestJS API skeleton with health endpoint

**Issue:** https://github.com/yskartheek/BoothConnect/issues/9
**What changed:**

- New app `apps/api` (`@boothconnect/api`): NestJS 12, TypeScript strict mode,
  every route under `/v1`
- Configuration is validated at startup; a missing or invalid variable stops
  the API with a list of the problems
- `GET /v1/health` checks PostgreSQL and Redis: `200` when both are up, `503`
  when either is down
- JSON logging (pino) with a request ID on every line and in the
  `X-Request-Id` response header
- Jest with unit tests and HTTP tests (21 tests, no Docker needed)
- **Node.js 24 LTS is now required** (`engines.node` is `>=24.11`, `.nvmrc`
  is 24). See the notes below.

## Before you start: install Node 24

With nvm-windows:

```powershell
nvm install 24
nvm use 24
node -v                            # expect v24.11 or newer
corepack enable                    # pnpm is set up per Node version
```

Without nvm: install Node.js 24 LTS from https://nodejs.org, then run
`corepack enable` again.

## Steps

1. Check out the branch, install, and create your `.env` (skip the copy if you
   already have one from #16):
   ```powershell
   git checkout claude/issue-9-api-skeleton
   pnpm install --frozen-lockfile
   Copy-Item infra/env/.env.example .env
   ```
2. Run the tests:
   ```powershell
   pnpm --filter api test
   ```
   **Expect:** `Tests: 21 passed, 21 total`.
3. Start the services and the API:
   ```powershell
   pnpm infra:up
   pnpm --filter api dev
   ```
   **Expect:** after a few seconds, a line ending in
   `API listening on http://localhost:4000/v1`. Leave this terminal open.
4. Open http://localhost:4000/v1/health in your browser.
   **Expect:**
   ```json
   {
     "status": "ok",
     "checks": {
       "database": { "status": "up", "latencyMs": 1 },
       "redis": { "status": "up", "latencyMs": 0 }
     }
   }
   ```
   The numbers can differ. In the API terminal you see a `request completed`
   log line with the request ID.
5. Check the request ID in a second terminal:
   ```powershell
   curl.exe -i http://localhost:4000/v1/health
   curl.exe -i -H "X-Request-Id: my-test-1" http://localhost:4000/v1/health
   ```
   **Expect:** the first response has an `x-request-id` header with a random
   UUID; the second has `x-request-id: my-test-1`, and the API log shows
   `"id":"my-test-1"`.
6. Check the health endpoint notices an outage:
   ```powershell
   docker compose -f infra/docker-compose.yml stop redis
   curl.exe -i http://localhost:4000/v1/health
   docker compose -f infra/docker-compose.yml start redis
   ```
   **Expect:** `HTTP/1.1 503 Service Unavailable` with `"redis":{"status":"down"...}`.
   The API keeps running. After `start redis`, the health page is back to
   `"status":"ok"` within a few seconds.
7. Check the API refuses to start without configuration. Stop the API with
   Ctrl+C, then:
   ```powershell
   Rename-Item .env .env.off
   pnpm --filter api dev
   ```
   **Expect:** it stops with `Invalid environment configuration:` and lists
   `DATABASE_URL` and `REDIS_URL`. Press Ctrl+C, then restore the file:
   ```powershell
   Rename-Item .env.off .env
   ```
8. Optional: build and run the compiled version:
   ```powershell
   pnpm --filter api build
   pnpm --filter api start
   ```
   **Expect:** the same health response as in step 4.

## Pass criteria

- Step 2 passes, and steps 4–7 give the expected results.

## Known issues and notes

- **Why Node 24?** NestJS 12 ships as ES modules. The API itself runs on Node
  20.19+, but Jest can only load ES modules from CommonJS tests on Node 24.9
  or newer. Node 20 reached end of life in April 2026, so the whole repo now
  targets Node 24 LTS. CI (#17) will use Node 24 too.
- **Logs in development are pretty-printed on one line per entry.** Set
  `NODE_ENV=production` in `.env` to see the raw JSON lines instead.
- **Port 4000 already in use?** Change `API_PORT` in `.env` (and
  `NEXT_PUBLIC_API_BASE_URL` to match).
- **The health check uses a plain PostgreSQL connection for now.** It moves to
  Prisma when the database schema arrives.
- **Unknown routes return NestJS's default 404 body.** The structured error
  format (`{ requestId, code, message, details }`) comes with the API core
  work in Epic 3.
