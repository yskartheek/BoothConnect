# #37: Households list (scoped, search, visit status, pages)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/37
**What changed:**

- `GET /v1/households` lists the households a user may see:
  - **volunteers** see only their booth's households;
  - **admins** see every booth below their assignment;
  - `boothId=<id>` narrows the list to one booth. A booth outside your area
    gives an **empty list**, the same as an empty booth, so nobody can tell
    whether it has households.
- **Search** (`q`) by part of the address, the house number, a member's name
  (from the roll or as entered by a volunteer) or the start of an EPIC
  number.
- **Visit status** (`status`): `not_visited`, `visited` or `follow_up`. It's
  based on the household's latest visit; if a visit was corrected, the
  correction counts.
- Each household shows its number of members and its last visit (outcome and
  date).
- Results come in pages (50 by default) with a `nextCursor` for the next
  page. Adding households while someone is paging never repeats or skips one.
- Households no longer in the roll ("removed") aren't listed.

## Steps

1. Prepare as for #36 (branch `claude/issue-37-households-list`, then
   `db:deploy`, `db:seed`, `pnpm --filter api dev`, with `OTP_DEV_MODE=true`),
   and paste the `SignIn` helper from the #36 guide into a second PowerShell
   window.
2. As **volunteer A**, list households:
   ```powershell
   $a = SignIn "+919999900002"
   $list = Invoke-RestMethod "$api/households?limit=5" -Headers $a
   $list.items | Select-Object displayAddress, voterCount, lastVisit
   $list.nextCursor
   ```
   **Expect:** 5 households from booth 1, each with a member count and an
   empty `lastVisit`, and a `nextCursor` value.
3. Next page:
   ```powershell
   (Invoke-RestMethod "$api/households?limit=5&cursor=$($list.nextCursor)" -Headers $a).items | Select-Object displayAddress
   ```
   **Expect:** 5 different households.
4. Search by a name you saw in the data (Prisma Studio, `voter` table,
   `source_data` → name), or by part of an address:
   ```powershell
   (Invoke-RestMethod "$api/households?q=<name or address part>" -Headers $a).items | Select-Object displayAddress
   ```
   **Expect:** the matching households, only from booth 1.
5. As **volunteer B** (`+919999900003`), repeat step 2.
   **Expect:** only booth 2's households, none of the ones from step 2.
6. As volunteer A, ask for booth 2 explicitly (get its ID from the #36
   dropdown calls, or Prisma Studio):
   ```powershell
   Invoke-RestMethod "$api/households?boothId=<booth 2 id>" -Headers $a
   ```
   **Expect:** `items` empty and `nextCursor` empty.
7. Filter by visit status:
   ```powershell
   (Invoke-RestMethod "$api/households?status=not_visited&limit=200" -Headers $a).items.Count
   (Invoke-RestMethod "$api/households?status=visited" -Headers $a).items.Count
   ```
   **Expect:** all of booth 1's households are "not visited" (no visits are
   recorded yet; visits come in #41), and 0 are visited.
8. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "GET /v1/households".

## Pass criteria

- Steps 2–8 give the expected results.

## Known issues and notes

- **No visits exist until #41** (recording visits), so the visit-status
  filter only becomes interesting then. The tests insert visits directly.
- Household details (`GET /v1/households/<id>`) come in #38.
