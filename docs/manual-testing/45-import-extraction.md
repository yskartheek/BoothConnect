# #45: Roll imports, reading uploaded PDFs (extraction) and checking them

**Issue:** https://github.com/yskartheek/BoothConnect/issues/45
**What changed:**

- After an upload (#44), each PDF is sent to the **roll-parser**, the
  separate program that reads roll PDFs. The API collects what it read.
- For each file the API:
  - reads the **cover page** and checks that the roll belongs inside the
    area the batch was opened for. A roll for another AC, or another part in
    a part-level batch, is **rejected**, with the reason.
  - finds the **part and polling stations** it belongs to. If they don't
    exist yet, they are only proposed; they are created when the file is
    confirmed (#47).
  - stores every voter box read from the roll for review, with how
    confident the reading was and any problems found (e.g. age out of
    range, or an EPIC number already listed in another part).
  - compares the **totals printed on the roll** with the voters actually
    read.
- **The outcome for each file:**
  - `ready`: everything matches.
  - `needs_review`: the totals don't match, a row has an error, or the
    reading was unsure.
  - `rejected`: wrong area, or not a roll.
  - `failed`: the PDF couldn't be read.
- **Nothing becomes a live household or voter yet.** That only happens on
  confirm (#47).
- **Use test files only. Never upload real electoral rolls.**

## Steps

1. Prepare as for #44 (branch `claude/issue-45-extraction`, `pnpm infra:up`,
   `db:deploy`, `db:seed`, `pnpm --filter api dev`, with `OTP_DEV_MODE=true`).
2. Start the roll-parser in Docker (no Python needed on your machine; the
   first build takes several minutes):
   ```powershell
   docker compose -f infra/docker-compose.yml --profile roll-parser up -d --build roll-parser
   Invoke-RestMethod http://localhost:8090/health
   ```
   **Expect:** `status` is `ok`.
3. Upload a small test PDF as in steps 2–4 of the #44 guide.
   **Expect:** the file's status in the answer is `extracting` (it went to
   the roll-parser).
4. After a few seconds, look at the file in Prisma Studio
   (`pnpm --filter api exec prisma studio`, table `import_file`).
   **Expect:** status `rejected` with error code `not_a_roll`. The test PDF
   has no voter pages, and that proves the round trip API → roll-parser →
   API works.
5. Run the tests (MinIO must be running):
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "roll extraction hand-off and results".
   They play the roll-parser's part with made-up results and cover:
   - a good roll becoming `ready`;
   - a roll from another AC being rejected;
   - a totals mismatch forcing review;
   - a new part being proposed;
   - duplicate EPICs;
   - the worker's failures;
   - a missed result being picked up later.

## Pass criteria

- Steps 2–5 give the expected results.

## Known issues and notes

- Reviewing and correcting the rows (#46) and confirming a file (#47) come
  next. Until then, `ready` files just wait.
- On the real sample roll the roll-parser's reading quality is still being
  improved (#128), so a real roll would usually land in `needs_review`.
