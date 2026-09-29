# #52: API documentation (OpenAPI), Swagger UI and the typed client

**Issue:** https://github.com/yskartheek/BoothConnect/issues/52
**What changed:**

- **API description.** `docs/api/openapi.json` describes every endpoint:
  - its parameters and request body, with the field descriptions;
  - what it returns;
  - its errors;
  - whether it needs sign-in or an `Idempotency-Key`.

  It is generated from the API code, never edited by hand.

- **Swagger UI** at `http://localhost:4000/v1/docs` shows it in the browser
  while developing. You can sign in there and try requests.
- **Typed client.** `packages/api-client` is a client for the admin web,
  generated from that file. Calling an endpoint that doesn't exist, or
  sending the wrong fields, is caught before the code runs.
- **CI** fails if the file or the client is out of date with the code.

## Steps

1. Prepare as usual (branch `claude/issue-52-openapi`, `pnpm install`,
   `pnpm infra:up`, `db:deploy`, `db:seed`), then start the API with
   `pnpm --filter api dev` and `OTP_DEV_MODE=true`.
2. Open http://localhost:4000/v1/docs in a browser.
   **Expect:** the BoothConnect API page, with groups such as Auth,
   Households, Voters, Visits, Sync, Imports, Analytics and Audit.
3. Open **Households → GET /v1/households**.
   **Expect:** the query parameters (`boothId`, `q`, `status`, `limit`,
   `cursor`), a 200 response described as a `HouseholdPage`, and an error
   response.
4. Try it:
   - In another window, sign in as volunteer A with the `SignIn` helper
     from the #36 guide, and copy the access token (`$h.Authorization`
     without `Bearer `).
   - On the Swagger page, click **Authorize** and paste the token.
   - Run **GET /v1/households**.

   **Expect:** the station-1 households.

5. Check that the committed file matches the code:
   ```powershell
   pnpm --filter api openapi:check
   ```
   **Expect:** `docs/api/openapi.json is up to date.`
6. Run the client's tests:
   ```powershell
   pnpm --filter @boothconnect/api-client test
   pnpm --filter @boothconnect/admin-web test
   ```
   **Expect:** all pass. The first checks that the client's types match
   the file; the second shows the admin web calling the API through the
   typed client.

## Pass criteria

- Steps 2–6 give the expected results.

## Known issues and notes

- Swagger UI is only served outside production.
- The spec doesn't say which role (volunteer, admin…) each endpoint needs.
  The API README describes the roles, and the cross-booth suite (#51)
  tests them.
