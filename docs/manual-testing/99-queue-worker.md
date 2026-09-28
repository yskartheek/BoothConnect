# #99: roll-parser queue worker (extract-roll jobs in, results out)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/99
**What changed:**

- `roll-parser worker`: takes **`extract-roll`** jobs from the
  **`roll-extraction`** queue in Redis, using the official BullMQ client for
  Python, so the API can add jobs with BullMQ for Node as usual. For each job
  it:
  1. downloads the PDF from the private bucket (and checks its SHA-256 when
     the job gives one),
  2. extracts header, totals and every row (#97, #98),
  3. writes `extractions/<importFileId>/result.v1.json` (the full result) and
     `pages/<n>.jpg` for the cover, voter and summary pages. **The
     maps/photos page is never rendered.**
  4. completes the job with a small summary (counts, quality, issue counts,
     object keys).
- A broken or unsuitable file (corrupt, encrypted, not a roll, too big, too
  slow, wrong checksum) gives `status: "failed"` with a reason code. Storage or
  network errors are retried by BullMQ.
- Timeout per file, concurrency setting, JSON logs without voter data, and
  `GET /health` on port 8090 (used by Docker's health check).
- **The contract for the API (#45)** is in
  `docs/design/roll-parser-contract.md`, with JSON Schemas in
  `apps/roll-parser/contract/`.
- `infra/docker-compose.yml`: the `roll-parser` service now runs the worker,
  connected to the Redis and MinIO containers (still behind its own profile).
- CI: the Roll parser job also starts Redis and MinIO and runs the integration
  test: a synthetic roll goes through the queue and comes back with the right
  counts; a corrupt PDF comes back `failed` with a reason.

## Steps

Needs Docker Desktop, and the roll-parser set up (see #95 or
`docs/SETUP.md` section 6) for steps 1–2.

1. **Integration test:**
   ```powershell
   pnpm infra:up
   pnpm --filter roll-parser test:int
   ```
   **Expect:** `1 passed`. It creates the `boothconnect-imports` bucket if
   needed, uploads the synthetic roll and a corrupt file, runs the worker, and
   checks both results and `/health`.
2. **Run the worker yourself** (Windows directly):
   ```powershell
   pnpm --filter roll-parser worker
   ```
   **Expect:** one JSON log line: `{"...","message": "worker started", "queue": "roll-extraction", ...}`.
   In another window, open http://localhost:8090/health.
   **Expect:** `{"status": "ok", "worker": "running", "redis": "up", ...}`.
   Stop it with Ctrl+C (`"message": "worker stopping"`).
3. **Or in Docker:**
   ```powershell
   docker compose -f infra/docker-compose.yml --profile roll-parser up -d --build roll-parser
   docker compose -f infra/docker-compose.yml ps
   ```
   **Expect:** `boothconnect-roll-parser-1 ... (healthy)` after about 20
   seconds. `docker compose -f infra/docker-compose.yml logs roll-parser`
   shows the JSON log lines. Stop it with
   `docker compose -f infra/docker-compose.yml --profile roll-parser stop roll-parser`.
4. **Send a job by hand (optional).** With the worker running (step 2 or 3):
   1. Open the MinIO console at http://localhost:9001 (`boothconnect` /
      `boothconnect-dev-secret`), open the `boothconnect-imports` bucket and
      upload `apps/roll-parser/tests/fixtures/small.pdf` into a folder
      `manual/`.
   2. Add a job from Python:
      ```powershell
      cd apps/roll-parser
      uv run python -c "import asyncio; from bullmq import Queue; q = Queue('roll-extraction', {'connection': 'redis://localhost:6379'}); j = asyncio.run(q.add('extract-roll', {'importFileId': 'manual-1', 'bucket': 'boothconnect-imports', 'key': 'manual/small.pdf'})); print('job', j.id)"
      ```
   **Expect:** the worker logs `"extraction completed"` with
   `"row_count": 42`, and MinIO now has `extractions/manual-1/result.v1.json`
   and `pages/1.jpg`, `3.jpg`, `4.jpg`, `5.jpg` (no `2.jpg`: that's the maps
   page).
5. **Your own sample, through the queue (optional):** as step 4, but upload
   your PDF. The log line shows `row_count` 571 and the issue counts, and no
   voter data. The result file in MinIO **does** contain voter data: delete it
   afterwards (or `pnpm infra:reset`).

## Pass criteria

- Step 1 passes (CI runs it too).
- Step 2 or 3 shows a healthy worker.

## Known issues and notes

- **Nothing sends these jobs yet**: the API side comes in #45, which follows
  `docs/design/roll-parser-contract.md`.
- **Page images are JPEG at the page's own resolution** (about 1984 × 2807,
  300–500 KB each), for the side-by-side correction screen.
- **Retention:** results and page images stay in the bucket like the PDFs;
  the retention rule is still to be decided (design §10).
- The first job after start-up takes a few seconds longer while the page
  worker processes start.
