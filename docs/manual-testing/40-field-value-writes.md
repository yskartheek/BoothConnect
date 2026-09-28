# #40: Saving member details (edits, conflicts, rejections)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/40
**What changed:**

This adds the **one piece of the server that saves member and household
details**. Recording visits (#41), phone uploads (#43), and member and
household edits (#112, #113) will all use it. It has **no endpoint of its
own yet**, so this guide checks it through the automated tests plus a
quick look at the database.

- **An edit counts immediately.** The new value becomes the current one.
  The old value is kept as history, and the official roll data is never
  changed.
- **Conflicts:** two volunteers editing the same detail offline, both
  starting from the same value. The first one to upload is saved normally.
  The second is also saved, but marked as a **conflict**. Both values are
  kept, and the volunteer chooses which one to keep later (#113).
  **Nothing is ever lost.**
- **Rejected, and nothing saved:**
  - a switched-off field (religion, political affiliation);
  - caste/community without the person's recorded consent (or with
    withdrawn consent, or someone else's);
  - a value that doesn't fit the field (e.g. a gender that isn't in the
    list, an age that isn't a number, a mobile number not in `+91…` form);
  - a member outside the volunteer's area.

## Steps

1. Check out the branch `claude/issue-40-field-value-writes` and start the
   infrastructure as usual (`pnpm infra:up`).
2. Run the tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "FieldValuesService.write", which has 13
   tests:
   - a direct edit is current immediately and `source_data` is unchanged;
   - two stale edits produce a conflict and neither value is lost;
   - an edit that arrives while another is still saving waits for it, then
     conflicts;
   - switched-off fields, missing or withdrawn consent, bad values and
     members outside the area are rejected.
3. Optional, to see the history rules in the data: open Prisma Studio
   (`pnpm --filter api exec prisma studio`), table `field_value`, and
   filter by `is_current`. Every old value is still there with
   `is_current = false`, and the value that replaced it has
   `supersedes_id` pointing at it.

## Pass criteria

- Step 2 passes.

## Known issues and notes

- You'll be able to try this from the app once #41 (visits) and #113
  (member edits) are in.
- Clearing a field (saving an empty value) isn't supported yet.
