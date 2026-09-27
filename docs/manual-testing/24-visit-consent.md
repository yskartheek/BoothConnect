# #24: Schema for visits and consent

**Issue:** https://github.com/yskartheek/BoothConnect/issues/24
**What changed:**

- New tables (migration `…_visits_consent`):
  - `visit`: household, volunteer, start and finish time, outcome (the 10
    outcomes from spec §7.4, e.g. completed, no one available, refused,
    household moved), form version, **`client_id`** from the phone
    (unique, so an upload repeated after a bad connection can't create a
    second visit), notes, and `corrects_visit_id` for corrections
  - `visit_member`: which household members the volunteer met (spec v1.1)
  - `consent`: given by a member or by a household, for a purpose (a field
    key such as `caste_community`, or `household_location`), with the notice
    version, how it was captured, who captured it and when, and withdrawal
- The consent links that were left open in #22 and #23 are now real foreign
  keys: `field_value.consent_id` and `household.location_consent_id`
- Rules enforced by the database:
  - **visit history is immutable**: a mistake is fixed by a new visit that
    points at the wrong one (same household only)
  - a visit's volunteer belongs to the household's organization; it can't
    finish before it starts; members met must live in that household
  - a consent can only be **withdrawn**, once; it's never edited or deleted
    (new consent is a new record)
  - a value that needs consent is only accepted with a **granted** consent,
    **for that field**, **from that person**; a household location needs a
    `household_location` consent from the household or one of its members

## Steps

1. Check out the branch, install and migrate:
   ```powershell
   git checkout claude/issue-24-visit-consent
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   ```
   **Expect:** `…_visits_consent` is applied.
2. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** `Tests: 42 passed`. The new ones include "rejects a second
   visit with the same client_id".

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **Withdrawing consent doesn't remove values already collected.** What
  happens to them (hide, delete after a period) is part of the retention
  rules still to be decided (spec §22).
- **Corrections are recorded, but the audited correction workflow** (who may
  correct, and the audit event) comes with the API (#34, #41).
