# @boothconnect/api

NestJS 12 REST API. Every route is under `/v1`.

```powershell
pnpm infra:up                  # Postgres, Redis, MinIO (from the repo root)
pnpm --filter api dev          # http://localhost:4000/v1/health, restarts on changes
pnpm --filter api test         # unit + HTTP tests (no Docker needed)
pnpm --filter api test:int     # integration tests against real Postgres + Redis
pnpm --filter api build        # compile to dist/
pnpm --filter api start        # run the compiled build
```

## Layout

| Path                 | What it holds                                                    |
| -------------------- | ---------------------------------------------------------------- |
| `src/main.ts`        | Bootstrap: logger, `configureApp`, listen on `API_PORT`          |
| `src/app.setup.ts`   | Global prefix, CORS, shutdown hooks (shared with the HTTP tests) |
| `src/config/`        | Environment validation (zod) and logging setup                   |
| `src/health/`        | `GET /v1/health`: checks the database and Redis, 200 or 503      |
| `test/*.e2e-spec.ts` | HTTP tests against the real app wiring, external services faked  |

## Configuration

Settings come from environment variables, then `apps/api/.env`, then the
repository-root `.env` (template: `infra/env/.env.example`). The API refuses
to start if a required variable is missing or invalid, and lists every
problem.

## Logging

Logs are JSON lines (pino), pretty-printed when `NODE_ENV=development`. Each
request gets an ID: a well-formed `X-Request-Id` header from the caller is
kept, otherwise a UUID is generated. The ID is returned in the
`X-Request-Id` response header and attached to every log line of that
request. `Authorization` and `Cookie` headers are redacted.
