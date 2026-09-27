# #20: Schema for users, sessions and role assignments

**Issue:** https://github.com/yskartheek/BoothConnect/issues/20
**What changed:**

- New tables (migration `…_users_sessions_roles`):
  - `app_user`: organization, name, phone (unique, E.164 like
    `+919876543210`), email (unique, lower-case), status
    (`active`/`suspended`), preferred language, MFA state, last login
  - `session`: one per signed-in device; stores only a SHA-256 hash of the
    current refresh token (unique), expiry, revocation, last use
  - `role_assignment`: user + role (`admin`, `campaign_manager`,
    `volunteer`, `voter`) + geography node + validity window + who granted it
- Rules enforced by the database:
  - a validity window must end after it starts
  - a role can only be on a geography node of the user's own organization,
    and only granted by someone from that organization
  - emails are stored lower-case, so "Admin@x.org" and "admin@x.org" can't
    both exist
- An index for "which assignments does this user have right now" (used on
  every request once sign-in exists)

## Steps

1. Check out the branch, install and migrate:
   ```powershell
   git checkout claude/issue-20-users-sessions-roles
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   ```
   **Expect:** `…_users_sessions_roles` is applied.
2. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** `Tests: 15 passed`. The new ones check which assignments are
   active at a given time (expired, current, open-ended, not yet started), that
   the query uses the index, and each rule above.
3. Optional: `pnpm --filter api db:studio` shows the new tables.

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **No sign-in yet.** These are only the tables; OTP sign-in, tokens and
  suspension checks come in #29–#31.
- **Assignments cover the node and everything below it.** For example, an
  admin on AC 40 covers all its parts and booths; the scope rules come in #33.
- **Seed and bootstrap assignments have no "granted by"** user; all others
  record who granted them.
