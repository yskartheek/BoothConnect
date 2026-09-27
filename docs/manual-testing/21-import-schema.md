# #21: Schema for roll imports (source versions, batches, files, rows)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/21
**What changed:**

- New tables (migration `…_imports`):
  - `source_version`: one published revision of one part's roll (year, type,
    roll identification, qualifying and publication dates, checksum), linked
    to the revision it replaces
  - `import_batch`: one upload at the level the admin picked (State, PC, AC
    or Part), who uploaded and who confirmed it, and its status
  - `import_file`: one roll PDF in a batch: storage key, name, size,
    SHA-256, status (uploaded → extracting → needs review / ready → confirmed,
    or rejected / duplicate / failed), detected header, matched part, quality
    score, printed vs extracted totals, error
  - `import_row_result`: one voter box from a page: page and position,
    section and serial number, status (accepted / warning / rejected),
    messages, raw OCR text, extracted values, confidence per field, and the
    admin's corrections
- Rules enforced by the database:
  - a batch can target State, PC, AC or Part, but not a polling station
  - a file's part must be a part **inside** the batch's target (a part from
    AC 41 can't land in an AC 40 batch)
  - the same PDF (same SHA-256) can only be live once; duplicates are kept as
    `duplicate` rows pointing at the original, and a rejected or failed file
    can be uploaded again
  - checksums must be SHA-256 hex; quality scores are 0–1; pages start at 1

## Steps

1. Check out the branch, install and migrate:
   ```powershell
   git checkout claude/issue-21-import-schema
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   ```
   **Expect:** `…_imports` is applied.
2. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** `Tests: 21 passed`. The new ones cover every rule above.
3. Optional: `pnpm --filter api db:studio` shows the new tables.

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **These are only the tables.** Uploading, extraction and review come in
  #44–#47 and Epic 9 (#94).
- **Why the partial unique index looks odd in the schema:** PostgreSQL stores
  `status NOT IN (...)` as `status <> ALL (ARRAY[...])`, and Prisma compares
  the text, so the schema uses PostgreSQL's form to avoid false "drift".
