# #35: Safe retries with an Idempotency-Key

**Issue:** https://github.com/yskartheek/BoothConnect/issues/35
**What changed:**

- Volunteers' phones will often send a request, lose the connection before
  the answer arrives, and send it again. Endpoints that change data (saving
  a visit, syncing, uploading) can now be marked so that **a retry is never
  applied twice**:
  - the app sends an `Idempotency-Key` header, a random ID per action and
    the same for every retry of that action;
  - a retry of a completed request gets **the first answer back** (with
    `Idempotency-Replayed: true`); nothing is saved again;
  - reusing a key for a **different** request is refused (422
    `IDEMPOTENCY_KEY_REUSED`);
  - if two copies arrive **at the same moment**, only one runs; the other
    waits for its answer;
  - if the request **failed**, nothing is remembered, so the retry runs
    normally.
- Answers are remembered for 7 days (`IDEMPOTENCY_TTL_SECONDS`), long enough
  for a phone that was offline for days to retry its queue.

The first real endpoints to use this (visits and sync) come in Epic 4
(#41–#43). Until then, the automated tests check it with a test-only
endpoint.

## Steps

1. Check out the branch and start the services:
   ```powershell
   git checkout claude/issue-35-idempotency
   pnpm install --frozen-lockfile
   pnpm infra:up
   ```
2. Run the tests:
   ```powershell
   pnpm --filter api test
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "request fingerprint" and
   "Idempotency-Key":
   - no key or a malformed key gives 400;
   - a replay returns the same answer and the write runs only once;
   - the same body with its fields in another order counts as the same
     request;
   - the same key with a different body gives 422;
   - two users can use the same key independently;
   - two simultaneous copies run the write once and both get its answer;
   - a failed write isn't remembered; a duplicate waiting on it gets 409;
   - empty answers (204) replay too;
   - records are kept 7 days.

## Pass criteria

- Step 2 passes.

## Known issues and notes

- **Try it by hand with #41–#43** (visits and sync), when the mobile app's
  queue starts sending these headers.
- Expired records aren't deleted yet; a cleanup job comes with the other
  scheduled jobs. They are ignored once expired, so this only affects disk
  space.
