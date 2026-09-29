# #47: Roll imports, confirming a file or batch (making it live)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/47
**What changed:**

- **Confirm a file** (`POST /v1/imports/files/:id/confirm`) once it has been
  reviewed, or **confirm a whole batch** (`POST /v1/imports/batches/:id/confirm`),
  which confirms every file that is `ready`.
- Only then does anything become live. In the background, for each file:
  - its **part and polling stations** are linked, or created (the auxiliary
    stations too);
  - a new **revision** of the part is recorded. The previous revision is
    kept for comparison, and its voters are marked "superseded";
  - voters are grouped into **households** by house number. "H NO 5-1" and
    "5-1" are the same house. A house already known keeps what volunteers
    recorded. Official houses no longer on the roll are marked "removed";
    houses volunteers added are never removed;
  - one **voter** is added per row, with the admin's corrections applied.
    Rejected rows and entries marked deleted on the roll are left out;
  - each voter goes to the main station, or to the auxiliary station that
    covers their section or serial range;
  - the file becomes `confirmed`, and it is all recorded in the audit log
    (counts only, never voter data).
- A file can't be confirmed while any of these is true:
  - a row still has an error;
  - an EPIC number appears twice;
  - the totals don't match what's printed on the roll. The admin can
    confirm anyway after checking why.
- A file can't be confirmed twice.
- **Use test files only. Never upload real electoral rolls.**

## Steps

1. Prepare as for #46 (branch `claude/issue-47-import-confirm`,
   `pnpm infra:up`, `db:deploy`, `db:seed`, `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`). Paste the `SignIn` helper from the #36 guide into a
   second PowerShell window.
2. Upload a small test PDF as in steps 2–4 of the #44 guide (keep `$ad`,
   `$batch`, `$done`).
3. Try to confirm it:
   ```powershell
   $f = $done.files[0].id
   Invoke-RestMethod "$api/imports/files/$f/confirm" -Method Post -Headers $ad -Body '{}' -ContentType "application/json"
   ```
   **Expect:** `409 Conflict`: the test PDF isn't a roll, so it was
   rejected (or is still `extracting`). Only reviewed files can be
   confirmed.
4. Try to confirm the batch:
   ```powershell
   Invoke-RestMethod "$api/imports/batches/$($batch.id)/confirm" -Method Post -Headers $ad
   ```
   **Expect:** `422`, "No file in this batch is ready to confirm".
5. As **volunteer A**, try step 4:
   ```powershell
   $v = SignIn "+919999900002"
   Invoke-RestMethod "$api/imports/batches/$($batch.id)/confirm" -Method Post -Headers $v
   ```
   **Expect:** `403 Forbidden`.
6. Run the tests (MinIO must be running):
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "import confirm". They use made-up
   files and check:
   - nothing is live before confirm, and part, stations, households and
     voters are after it;
   - confirming twice is refused;
   - files with errors or a totals mismatch are held back;
   - a failed commit goes back to review;
   - batch confirm;
   - a second revision of seed part 1 keeps the first one. Its old voters
     are superseded, house 1-3 is kept, and the other houses are marked
     removed;
   - section-2 voters go to auxiliary station 1A.

## Pass criteria

- Steps 3–6 give the expected results.

## Known issues and notes

- As in #46, a synthetic roll (State S29, AC 40) can't be imported against
  the development seed (S99 / AC 101), so confirming real rows by hand has
  to wait for the master-data upload (#100) or the admin web.
- **Volunteer data after a new revision:**
  - Details, visits and consents recorded for a voter stay with that voter
    when a new revision supersedes them. They aren't yet copied to the new
    revision's entry with the same EPIC number.
  - Members added by volunteers stay active, even when their house is
    marked removed.
- Auxiliary-station coverage is set on the station. Editing it (and moving
  voters when it changes) is #101.
- The analytics refresh after confirm is only requested. The analytics
  themselves are #102.
