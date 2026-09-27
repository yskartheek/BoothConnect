# #26: Development seed data

**Issue:** https://github.com/yskartheek/BoothConnect/issues/26
**What changed:**

- `pnpm --filter api db:seed` (also run by `db:reset`) fills the database
  with **synthetic** demo data (plan §7, spec v1.1):

  | What                  | Details                                                                                                                                                    |
  | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Organization, program | BoothConnect Demo Organization; Demo General Election 2026 (active)                                                                                        |
  | Geography             | Demo State `S99` → PC `1` → AC `101` → parts `1` (Demo Nagar) and `2` (Sample Colony) → stations `1`, `1A` (auxiliary, covers section 2 of part 1) and `2` |
  | Users                 | Admin `+91 99999 00001` (on AC 101), Volunteer A `+91 99999 00002` (station 1), Volunteer B `+91 99999 00003` (station 2)                                  |
  | Roll import           | One confirmed import per part (revision "Demo Revision 2026")                                                                                              |
  | Households            | 40 (20 per part), with structured addresses; 3 have a location, each with a `household_location` consent                                                   |
  | Members               | 120 from the roll (fake EPICs `DMO…`, 2 sections per part; section 2 of part 1 votes at 1A) + 1 added by a volunteer                                       |
  | Fields                | name, age, gender, mobile, occupation, additional info (enabled); caste/community (enabled, needs consent); religion and political affiliation (disabled)  |
  | Field values          | 5 (the volunteer-added member's name, age and gender; one member's occupation and mobile)                                                                  |

- Everything is made up: a state code that doesn't exist, fake phone numbers
  and voter IDs, and combinations of common names.
- **Safe to run again:** it uses fixed IDs and skips rows that already exist.

## Steps

1. Check out the branch, install, migrate and seed:
   ```powershell
   git checkout claude/issue-26-seed
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   pnpm --filter api db:seed
   ```
   **Expect:** `Seed data is in place: { geographyNodes: 8, users: 3,
households: 40, voters: 121, fieldDefinitions: 9, fieldValues: 5,
consents: 3 }`.
2. Run the seed again.
   **Expect:** exactly the same numbers (nothing is duplicated).
3. Look at the data:
   ```powershell
   pnpm --filter api db:studio
   ```
   **Expect:** in the browser, `geography_node` shows the 8 places, `voter`
   shows 121 rows (open one to see its `source_data`), and `household` shows
   3 rows with a latitude and longitude.
4. Optional: start over from an empty database:
   ```powershell
   pnpm --filter api db:reset
   ```
   **Expect:** Prisma asks you to confirm, drops everything, re-applies the
   migrations and runs the seed (the same numbers as step 1).
5. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "creates the plan §7 dataset and changes
   nothing when run again".

## Pass criteria

- Steps 1, 2 and 5 give the expected results.

## Known issues and notes

- **Sign-in with these users comes later** (#29–#33). The phone numbers are
  what you'll use then, with the development one-time code.
- **Caste/community is enabled for development only.** Its legal basis in the
  seed says so; the legal review in spec §22 is still needed before any real
  use.
- **The seed doesn't create visits.** Those come from the app (Epic 6).
