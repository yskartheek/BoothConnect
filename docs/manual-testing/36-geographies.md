# #36: Geography dropdowns (State → PC → AC → Part → Booth)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/36
**What changed:**

- `GET /v1/geographies` lists the places one level down from a given place
  (or the states at the top). The apps use it for the cascading dropdowns
  (State → PC → AC → Part → Booth).
- **Each user only sees their own areas:**
  - the path down to where they work (their state, PC, AC and part), so the
    dropdowns and breadcrumbs work;
  - everything below where they work;
  - **not** other parts or booths at the same level. Volunteer A (booth 1)
    sees part 1 under AC 101, but not part 2.
- Places are sorted naturally: part 2 comes before part 10 (not after it).
- Search with `q`: the start of the code (`q=408`) or part of the name.
- Long lists (an AC has 250–300 parts) come in pages of 50 by default, with a
  `nextCursor` to get the next page.
- `GET /v1/geographies/<id>` returns one place with its path from the top, or
  **404** if it's outside your areas.

## Steps

1. Check out the branch and prepare as for #30:
   ```powershell
   git checkout claude/issue-36-geographies
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   pnpm --filter api db:seed
   pnpm --filter api dev
   ```
   Keep `OTP_DEV_MODE=true` in `.env`.
2. In a second PowerShell window, add a helper that signs in with the code
   from the API log (it asks you to type the code):
   ```powershell
   $api = "http://localhost:4000/v1"
   function SignIn($phone) {
     Invoke-WebRequest -Method Post -Uri "$api/auth/otp/request" -ContentType "application/json" -Body (@{ phone = $phone } | ConvertTo-Json) | Out-Null
     $code = Read-Host "Code for $phone (from the API log)"
     $t = Invoke-RestMethod -Method Post -Uri "$api/auth/otp/verify" -ContentType "application/json" -Body (@{ phone = $phone; code = $code; deviceId = "my-laptop" } | ConvertTo-Json)
     @{ Authorization = "Bearer $($t.accessToken)" }
   }
   function Codes($list) { ($list.items | ForEach-Object { "$($_.type) $($_.code)" }) -join ', ' }
   ```
3. As the **admin** (`+919999900001`), walk down the tree:
   ```powershell
   $h = SignIn "+919999900001"
   $states = Invoke-RestMethod "$api/geographies" -Headers $h; Codes $states
   $pcs = Invoke-RestMethod "$api/geographies?parentId=$($states.items[0].id)" -Headers $h; Codes $pcs
   $acs = Invoke-RestMethod "$api/geographies?parentId=$($pcs.items[0].id)" -Headers $h; Codes $acs
   $parts = Invoke-RestMethod "$api/geographies?parentId=$($acs.items[0].id)" -Headers $h; Codes $parts
   $booths = Invoke-RestMethod "$api/geographies?parentId=$($parts.items[0].id)" -Headers $h; Codes $booths
   ```
   **Expect:** `state S99`, `pc 1`, `ac 101`, `part 1, part 2`, and
   `polling_station 1, polling_station 1A`.
4. As **volunteer A** (`+919999900002`), look at the same AC:
   ```powershell
   $v = SignIn "+919999900002"
   Codes (Invoke-RestMethod "$api/geographies?parentId=$($acs.items[0].id)" -Headers $v)
   Invoke-RestMethod "$api/geographies/$($parts.items[1].id)" -Headers $v
   ```
   **Expect:** only `part 1`; asking for part 2 by ID gives **404**.
5. Breadcrumbs for volunteer A's booth:
   ```powershell
   $b1 = (Invoke-RestMethod "$api/geographies?parentId=$($parts.items[0].id)" -Headers $v).items[0]
   (Invoke-RestMethod "$api/geographies/$($b1.id)" -Headers $v).path | ForEach-Object { "$($_.type) $($_.code)" }
   ```
   **Expect:** `state S99`, `pc 1`, `ac 101`, `part 1`.
6. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "GET /v1/geographies": natural order
   (1, 2, 3, 10, 408), paging with `limit=2`, and `q=408`.

## Pass criteria

- Steps 3–6 give the expected results.

## Known issues and notes

- The seed has only 2 parts; the tests add parts 3, 10 and 408 to check
  ordering, paging and search. Real ACs get their parts from the master-data
  upload (#100) and the roll imports (#44–#47).
- Creating or editing places (admin) comes with #100.
