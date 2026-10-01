# #78: API guide for client developers, and Swagger UI outside production

**Issue:** https://github.com/yskartheek/BoothConnect/issues/78
**What changed:**

- **[`docs/api/README.md`](../api/README.md)**, the guide for anyone writing a client:
  - a quick start (bash and PowerShell): sign in with a code, `/me`, pull, push a visit, pull again;
  - signing in: codes, limits, the access and refresh tokens, sign-out;
  - the error body and every error code by status;
  - booth scope: out-of-scope records are 404, never 403;
  - idempotency: the `Idempotency-Key` header, retries, replays, a reused key;
  - sync: pull pages and cursors, push mutations and the four result types (`applied`, `duplicate`, `conflict`, `rejected`), and `baseVersion`;
  - pagination, the endpoints by role, and how to regenerate the spec.
- **Swagger UI** at `/v1/docs` (from #52) is now tested: served outside production, a 404 in production.

## Steps

1. Prepare as usual (branch `claude/issue-78-api-docs`, `pnpm install`, `pnpm infra:up`, `db:deploy`, `db:seed`), then start the API with `OTP_DEV_MODE=true`:
   ```powershell
   $env:OTP_DEV_MODE = "true"; pnpm --filter api dev
   ```
2. Open http://localhost:4000/v1/docs.
   **Expect:** Swagger UI with the BoothConnect API.
3. Open `docs/api/README.md` on GitHub or in VS Code, and follow **Quick start → The same in PowerShell** in a new PowerShell window. Type the code from the API's log when asked.
   **Expect:**
   - `/me` shows the `volunteer` role;
   - the push shows `visit.create` with status `applied`;
   - the last pull has `reset: False` and the new visit in `visits`.
4. Run the push line again with the same `$push` headers.
   **Expect:** the same result, and nothing new is stored (the next pull has no new visit).
5. Optional, production: stop the API and start it with `$env:NODE_ENV = "production"` (and the other production settings it asks for). Open `/v1/docs`.
   **Expect:** a 404 (`NOT_FOUND`).

## Pass criteria

- Steps 1–4 give the expected results, using only the guide.

## Known issues and notes

- Codes can be requested 3 times per phone in 10 minutes. Repeating the steps quickly gives a 429: wait, or sign in as the admin (`+919999900001`) instead.
- The endpoint shapes are in `openapi.json` and Swagger UI. The guide covers the rules that apply across endpoints.
