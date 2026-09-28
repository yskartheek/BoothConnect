# #28: Structured error format, request IDs and validation

**Issue:** https://github.com/yskartheek/BoothConnect/issues/28
**What changed:**

- Every error from the API now has the same JSON shape:
  `{ requestId, code, message, details? }`.
  - `requestId` is the same as the `X-Request-Id` response header and the log
    lines, so a user can quote it when reporting a problem.
  - `code` is a stable name such as `VALIDATION_FAILED`, `NOT_FOUND`,
    `UNIQUE_VIOLATION` or `INTERNAL_ERROR`; the apps will use it to decide
    what to show.
  - Server errors (500) never include stack traces, internal messages or
    connection details; those only go to the log.
- Request bodies are checked against a definition for each endpoint. Wrong
  or missing fields give a 400 listing each field, unknown fields are
  rejected rather than silently ignored, and the values you sent are never
  repeated back (they may be personal data).
- Invalid JSON gives a 400 `MALFORMED_JSON` without quoting the body.
- Database errors are translated: a duplicate unique value is 409
  `UNIQUE_VIOLATION`, a missing record is 404 `NOT_FOUND`.

There are no endpoints with request bodies yet (sign-in comes in #29), so the
body checks are covered by automated tests. By hand you can see the error
format on any unknown address and on invalid JSON.

## Steps

1. Check out the branch, install, start the services and the API:
   ```powershell
   git checkout claude/issue-28-errors-validation
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api dev
   ```
2. In a second PowerShell window, ask for an address that doesn't exist:
   ```powershell
   curl.exe -i http://localhost:4000/v1/no-such-page
   ```
   **Expect:** `HTTP/1.1 404`, an `X-Request-Id` header, and a body like
   `{"requestId":"<same as the header>","code":"NOT_FOUND","message":"Cannot GET /v1/no-such-page"}`.
3. Send your own request ID:
   ```powershell
   curl.exe -i -H "X-Request-Id: my-test-1" http://localhost:4000/v1/no-such-page
   ```
   **Expect:** the header and `requestId` in the body are both `my-test-1`.
4. Send invalid JSON:
   ```powershell
   curl.exe -i -X POST -H "Content-Type: application/json" --data "{bad json" http://localhost:4000/v1/health
   ```
   **Expect:** `HTTP/1.1 400` and
   `{"requestId":"…","code":"MALFORMED_JSON","message":"The request body is not valid JSON"}`,
   with nothing from what you sent.
5. Check the health endpoint still works:
   ```powershell
   curl.exe http://localhost:4000/v1/health
   ```
   **Expect:** `{"status":"ok",…}` as before.
6. Run the tests:
   ```powershell
   pnpm --filter api test
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including the "error responses" tests (invalid body,
   unknown property, unknown error with no internals, database errors).

## Pass criteria

- Steps 2–5 give the expected responses and step 6 passes.

## Known issues and notes

- **A duplicate value names the database constraint, not the field**
  (`details: { constraint: "app_user_phone_key" }`). Prisma 7 with the
  Postgres adapter only reports the constraint. Endpoints where a duplicate is
  expected (for example an existing phone number) will return their own,
  clearer error.
- Error messages are in English. The apps translate by `code`, so the
  message is mostly for developers and logs.
