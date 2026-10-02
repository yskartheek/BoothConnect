# #210: API logs don't include search terms

**Issue:** https://github.com/yskartheek/BoothConnect/issues/210
**What changed:**

- The API's request log no longer shows what was searched. A search can hold a voter's name, house number or phone, so in the logged URL, query and Referer, `q` (and any parameter not known to be safe) reads `[redacted]`.
- IDs, cursors, dates, numbers and flags (`boothId`, `since`, `limit`, `status`, …) are still logged, so the log stays useful for debugging.
- Nothing changes for users: searches work as before.

## Steps

1. Start the API and the admin web (see [SETUP.md](../SETUP.md) sections 2–3 and 5), with this branch: `claude/issue-210-log-redaction`. Keep the API's window visible.
2. Sign in to the admin web as Demo Admin, open **Voters and households**, and search for a voter's name you can see in the list (e.g. the first name of someone in **H NO 1-3**).
   **Expect:** the search finds them, as before.
3. In the API window, find the log line for that search (`GET /v1/households`).
   **Expect:** `q=[redacted]` in the URL, `"q":"[redacted]"` in the query, and the Referer (if shown) with `q=[redacted]`. The name you typed appears nowhere in the window.
4. Search for a house number (`H NO 1-3`) and then a phone number (`9999900101`).
   **Expect:** the same: neither appears in the API window.

## Pass criteria

- Steps 1–4 give the expected results.

## Known issues and notes

- In development (`NODE_ENV=development`) the log is pretty-printed on one line per request; the redaction is the same.
- Paths are logged as they are; they only hold IDs.
