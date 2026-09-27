# #22: Schema for households and voters (source data can't change)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/22
**What changed:**

- New tables (migration `…_households_voters`):
  - `household`: a house in a part, grouped from the roll's house numbers
    (unique per part + normalised house number), its polling station, the
    latest revision that listed it, and status (`active` / `removed`).
    Households survive new roll revisions, so visits stay attached.
  - `voter`: one elector as printed in one revision: part, polling station,
    section and serial number, EPIC (`source_voter_id`), **`source_data`**
    (name, relation, relative, house number, age, gender, raw OCR text), the
    revision and file it came from, verification status (`unverified` /
    `verified` / `disputed`) and record status (`active` / `superseded` /
    `deleted`)
- Rules enforced by the database:
  - **`source_data`, EPIC, section/serial number, part, revision and file can
    never be changed** after import; corrections will be stored separately
    (#23)
  - a voter's station must be a station of its part (moving to the part's
    auxiliary station is allowed); its household and revision must be of the
    same part
  - EPIC and serial number are unique within one revision of a part, but the
    same EPIC can appear again in the next revision
- Indexes for "voters of this booth" and "voters of this part"

## Steps

1. Check out the branch, install and migrate:
   ```powershell
   git checkout claude/issue-22-household-voter
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   ```
2. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** `Tests: 26 passed`. The new ones include "refuses to change a
   voter's source data".

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **No voters exist yet in your database.** They arrive with the seed data
  (#26) and roll imports (#47).
- **Voters are per revision.** When a part gets a new revision, its voters are
  imported again as new rows and the old rows become `superseded`; EPIC links
  the two.
