# #164: Audit log, filtering by booth or area

**Issue:** https://github.com/yskartheek/BoothConnect/issues/164
**What changed:**

- `GET /v1/audit-events` takes `nodeId`: a booth, or any area above it
  (part, AC, …). It shows two kinds of events:
  - events about that area's households, members, visits and roll
    imports;
  - events by volunteers who were assigned there at the time, such as
    their sign-ins.
- To see one volunteer's actions, use `actorId` (their user ID). Both
  filters can be combined: "what did this volunteer do in this booth".
- Admins still see the whole log; this only narrows it down.

## Steps

1. Prepare as for #50 (`pnpm infra:up`, `db:deploy`, `db:seed`,
   `pnpm --filter api dev` with `OTP_DEV_MODE=true`, and the `SignIn` helper
   from the #36 guide).
2. Sign in as volunteer A, then as the admin, and look up volunteer A's
   booth:
   ```powershell
   $v = SignIn "+919999900002"
   $ad = SignIn "+919999900001"
   $booth = (Invoke-RestMethod "$api/me" -Headers $v).assignments[0].node.id
   ```
3. Show booth A's events:
   ```powershell
   (Invoke-RestMethod "$api/audit-events?nodeId=$booth&limit=10" -Headers $ad).items |
     Format-Table seq, action, resourceType, @{ n = 'actor'; e = { $_.actor.name } }
   ```
   **Expect:** volunteer A's `auth.login` from step 2. The admin's own
   sign-in is not listed.
4. Only volunteer A's actions in that booth:
   ```powershell
   $a = (Invoke-RestMethod "$api/me" -Headers $v).id
   (Invoke-RestMethod "$api/audit-events?nodeId=$booth&actorId=$a" -Headers $ad).items |
     Format-Table seq, action
   ```
   **Expect:** only volunteer A's events.
5. Run the tests:
   ```powershell
   pnpm --filter api test:int -- test/audit-events.int-spec.ts
   ```
   **Expect:** 9 pass, including "by booth or area". They check that:
   - booth A's visit, household, member and sign-in events are shown, and
     none of booth B's;
   - a part or an AC includes all its booths;
   - the filter combines with the others.

## Pass criteria

- Steps 3–5 give the expected results.

## Known issues and notes

- Events that aren't about a booth's records and weren't made by one of
  its volunteers aren't matched. For example, an admin signing in doesn't
  appear under a booth.
