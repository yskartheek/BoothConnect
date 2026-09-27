# #15: docker-compose for Postgres 16, Redis and MinIO

**Issue:** https://github.com/yskartheek/BoothConnect/issues/15
**What changed:**

- New `infra/docker-compose.yml` with three services, each with a healthcheck
  and a named volume:
  - `postgres` (`postgres:16-alpine`) on port 5432
  - `redis` (`redis:7-alpine`, append-only persistence) on port 6379
  - `minio` (S3-compatible storage) with the API on port 9000 and the web
    console on port 9001
- A one-shot `minio-init` job that creates the private `boothconnect-imports`
  bucket for import uploads. Running it again is safe.
- New root scripts:

  | Script             | What it does                                                 |
  | ------------------ | ------------------------------------------------------------ |
  | `pnpm infra:up`    | Starts all services, waits until healthy, creates the bucket |
  | `pnpm infra:down`  | Stops and removes the containers. **Data is kept.**          |
  | `pnpm infra:logs`  | Follows the logs of all services (Ctrl+C to stop)            |
  | `pnpm infra:reset` | Like `infra:down`, but also **deletes all data** (volumes)   |

## Development credentials

These defaults only exist for local development. #16 adds `.env.example`.

| Service       | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Postgres      | user `boothconnect`, password `boothconnect`, db `boothconnect`                |
| Redis         | no password                                                                    |
| MinIO console | http://localhost:9001, user `boothconnect`, password `boothconnect-dev-secret` |

## Steps

1. Start Docker Desktop and wait until it says **Engine running**. Then check
   out the branch:
   ```powershell
   git checkout claude/issue-15-docker-compose
   pnpm install --frozen-lockfile
   docker version                   # both Client and Server must be listed
   ```
2. Start the services:
   ```powershell
   pnpm infra:up
   ```
   **Expect:** the first run downloads the images (a few minutes). Then you see
   `Container boothconnect-postgres-1 Healthy`, the same for `redis` and
   `minio`, and finally `Bucket boothconnect-imports is ready`. The command
   ends by itself.
3. Check the status:
   ```powershell
   docker compose -f infra/docker-compose.yml ps
   ```
   **Expect:** `postgres`, `redis` and `minio` all show `Up ... (healthy)`.
   Docker Desktop shows the same under **Containers → boothconnect**.
4. Check Postgres and Redis respond:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -c "select version();"
   docker compose -f infra/docker-compose.yml exec redis redis-cli ping
   ```
   **Expect:** `PostgreSQL 16.x ...` and `PONG`.
5. Open the MinIO console at http://localhost:9001 and sign in with the
   credentials above.
   **Expect:** the bucket `boothconnect-imports` is listed. Upload any small
   file to it; you will use it in the next step.
6. Check data survives a restart:
   ```powershell
   pnpm infra:down
   pnpm infra:up
   ```
   **Expect:** the file you uploaded is still in the bucket.
7. Check the bucket is private. Replace `<file>` with the name you uploaded:
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" http://localhost:9000/boothconnect-imports/<file>
   ```
   **Expect:** `403` (anonymous downloads are refused).
8. Clean up, if you want a fresh start:
   ```powershell
   pnpm infra:reset
   ```
   **Expect:** containers, network and the three `boothconnect_*` volumes are
   removed.

## Pass criteria

- Step 2 ends without errors, and step 3 shows all three services healthy.
- Steps 4–7 give the expected output.

## Known issues and notes

- **"port is already allocated" / "address already in use".** Something else
  on your PC already uses that port, usually a locally installed PostgreSQL
  (5432). Stop it, or choose other ports for this terminal session, then run
  `pnpm infra:up` again:
  ```powershell
  $env:POSTGRES_PORT = "5433"   # also: REDIS_PORT, MINIO_API_PORT, MINIO_CONSOLE_PORT
  ```
- **MinIO image.** MinIO no longer publishes the `minio/minio` and `minio/mc`
  images, so we use the community fork `pgsty/minio` and `pgsty/mc` (same
  server, console and S3 API). Both are pinned to a release tag.
- **Docker Hub rate limits.** If a pull fails with `429 Too Many Requests`,
  wait a few minutes and try again, or sign in with `docker login`.
- **`minio-init` does not stay running.** That's expected: it creates the
  bucket and exits. It is not listed by `docker compose ps`.
- **Changing credentials after the first start.** Postgres and MinIO only read
  the user and password when their volume is created. If you change them, run
  `pnpm infra:reset` first (this deletes local data).
