# #23: Schema for configurable fields and their values (with history)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/23
**What changed:**

- New tables (migration `…_field_values`):
  - `field_definition`: a field that can be collected for voters or
    households: key, label key, type (text, number, yes/no, date, phone,
    single/multi select with options), purpose, and flags `is_restricted`,
    `enabled`, `requires_consent`, `legal_basis`
  - `field_value`: one value of one field for one voter or household, with
    **where it came from** (official import, voter self-submitted, volunteer
    collected, admin corrected, derived), its status (proposed / verified /
    rejected), who collected it and when, the consent it relies on, the value
    it replaces (`supersedes_id`) and the version the app last saw
    (`base_version`)
- Rules enforced by the database:
  - **values are append-only**: a change is a new row that supersedes the
    old one, so the full history is kept; only the verification status can be
    updated, and values can't be deleted
  - `is_current` marks the latest value of each chain automatically
  - **no values for disabled fields**; values must match the field's entity
    type (voter or household) and point at a real voter/household
  - consent fields need a consent record
  - **a restricted field (caste, religion, …) can't be enabled** unless it
    requires consent and has a documented legal basis
- An index for "the current value(s) of each field of this voter"

## Steps

1. Check out the branch, install and migrate:
   ```powershell
   git checkout claude/issue-23-field-values
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   ```
2. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** `Tests: 32 passed`. The new ones follow a 3-step history chain,
   keep both sides of a conflict, and check every rule above.

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **Conflicts:** when two people edit the same field from the same starting
  point, the second edit is stored without replacing anything, so both stay
  "current" until someone resolves it. The API's conflict handling comes in
  #40.
- **`consent_id` has no foreign key yet;** it's added with the consent table
  in #24.
- **The seed (#26) adds the restricted fields disabled.**
