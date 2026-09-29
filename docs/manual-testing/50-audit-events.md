# #50: Reading the audit log (admins)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/50
**What changed:**

- `GET /v1/audit-events` lists what happened (sign-ins, imports,
  corrections, visits, exports…), newest first, a page at a time.
- **Filters**: by who did it, the action (exact, or everything starting
  with e.g. `import.`), the record, the result, and a time range.
- `verify=true` also checks that the events in the time range haven't been
  changed or deleted. Each event carries a fingerprint that includes the one
  before it, so an edited or missing event breaks the chain.
- Admins only; volunteers get **403**. Every read of the log is itself
  recorded (`audit.view`).
- The log never holds voter data itself: names, phones and EPIC numbers are
  removed before an event is stored.

## Steps

1. Prepare as usual (branch `claude/issue-50-audit-events`,
   `pnpm infra:up`, `db:deploy`, `db:seed`, `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`). Paste the `SignIn` helper from the #36 guide into a
   second PowerShell window.
2. As the **admin**, list the latest events:
   ```powershell
   $ad = SignIn "+919999900001"
   $r = Invoke-RestMethod "$api/audit-events?limit=5" -Headers $ad
   $r.items | Format-Table seq, at, action, result
   ```
   **Expect:** your own `auth.login` among the newest events.
3. Only sign-ins, and the next page:
   ```powershell
   $r = Invoke-RestMethod "$api/audit-events?action=auth.*&limit=2" -Headers $ad
   $r.items | Format-Table seq, action
   Invoke-RestMethod "$api/audit-events?action=auth.*&limit=2&cursor=$([uri]::EscapeDataString($r.nextCursor))" -Headers $ad |
     ForEach-Object { $_.items } | Format-Table seq, action
   ```
   **Expect:** only `auth.…` actions, and the second page continues with
   older events (no repeats).
4. Check the chain for today:
   ```powershell
   $from = (Get-Date).Date.ToUniversalTime().ToString("o")
   (Invoke-RestMethod "$api/audit-events?verify=true&from=$from&limit=1" -Headers $ad).verification
   ```
   **Expect:** `intact` is `True`, `firstBrokenSeq` is empty, and
   `checked` is the number of events since midnight.
5. Your reads were recorded:
   ```powershell
   (Invoke-RestMethod "$api/audit-events?action=audit.view&limit=1" -Headers $ad).items[0].metadata
   ```
   **Expect:** the filters of your previous request.
6. As **volunteer A**:
   ```powershell
   $v = SignIn "+919999900002"
   Invoke-RestMethod "$api/audit-events" -Headers $v
   ```
   **Expect:** `403 Forbidden`.
7. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "GET /v1/audit-events". They switch off
   the database's protection in a test database, then edit and delete an
   event. They check that verification reports the first broken event,
   while a range without it stays intact.

## Pass criteria

- Steps 2–7 give the expected results.

## Known issues and notes

- Verifying a very large range checks every event in it and can take a
  while. Pick a time range.
- The log is for the whole deployment. Every admin can read all of it,
  not only their own area.
