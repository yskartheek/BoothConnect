# #22: Schema for households and voters (source data can't change; spec v1.1)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/22
**What changed:**

- New tables (migration `…_households_voters`):
  - `household`: a house in a part, grouped from the roll's house numbers
    **or added by a volunteer** (`origin`), unique per part + normalised house
    number, its polling station, a structured address (house no., street,
    area, PIN code, landmark), an optional **location** (latitude, longitude,
    accuracy, time, consent), the latest revision that listed it, and status
    (`active` / `removed`). Households survive new roll revisions, so visits
    stay attached.
  - `voter` (household member): either one elector as printed in one
    revision (part, station, section and serial number, EPIC,
    **`source_data`**: name, relation, relative, house number, age, gender,
    raw OCR text, plus the revision and file), or a **member added by a
    volunteer** with none of those. Record status: `active` / `superseded` /
    `deleted`. There is no approval status (spec v1.1): volunteers' edits
    become current values straight away (#23).
- Rules enforced by the database:
  - **`source_data`, EPIC, section/serial number, part, revision, file and
    origin can never be changed** after import; volunteer edits are stored
    separately as current values with history (#23)
  - official members must have all roll fields; volunteer-added members must
    have none; volunteer-added households have no revision
  - a location is all-or-nothing, within valid ranges, and needs a consent
    record
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
   **Expect:** `Tests: 28 passed`. The new ones include "refuses to change a
   voter's source data", volunteer-added households and members, and the
   location rules.

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **No voters exist yet in your database.** They arrive with the seed data
  (#26) and roll imports (#47).
- **`location_consent_id` has no foreign key yet;** it's added with the
  consent table in #24.
- **Voters are per revision.** When a part gets a new revision, its voters are
  imported again as new rows and the old rows become `superseded`; EPIC links
  the two.
