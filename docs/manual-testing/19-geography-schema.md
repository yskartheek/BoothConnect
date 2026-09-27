# #19: Schema for organization, election program and the geography tree

**Issue:** https://github.com/yskartheek/BoothConnect/issues/19
**What changed:**

- New tables: `organization`, `election_program`, `geography_node` and
  `geography_closure` (migration `…_geography`)
- Geography levels: `state → pc → ac → part → polling_station`. Codes are the
  official numbers (S29, PC 6, AC 40, part 408, auxiliary station 408A) and
  are unique among siblings; state codes are unique per program.
- Rules enforced by the database itself:
  - a node's parent must be the level directly above it, in the same program
  - only polling stations can be auxiliary
  - a node can be renamed, but never moved to another parent
  - `geography_closure` is filled automatically, so "everything under AC 40"
    or "the path from a booth up to the state" is one query
- `pnpm --filter api db:migrate` now also regenerates the Prisma client
  (Prisma 7 no longer does that by itself)

## Steps

1. Check out the branch, install, start the services and migrate:
   ```powershell
   git checkout claude/issue-19-geography-schema
   pnpm install --frozen-lockfile
   pnpm infra:up
   pnpm --filter api db:deploy
   ```
   **Expect:** `20260927152912_geography` is applied.
2. Run the integration tests:
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** `Tests: 10 passed`. They build State → PC → AC → 2 parts →
   3 stations (one auxiliary), check the closure queries and every rule above,
   and roll everything back.
3. Optional: see a rule in action in the database:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect
   ```
   then paste:
   ```sql
   INSERT INTO organization (id, name, updated_at) VALUES (gen_random_uuid(), 'Demo', now()) RETURNING id \gset org_
   INSERT INTO election_program (id, organization_id, name, type, updated_at) VALUES (gen_random_uuid(), :'org_id', 'Demo', 'general_election', now()) RETURNING id \gset prog_
   INSERT INTO geography_node (id, program_id, type, code, name, updated_at) VALUES (gen_random_uuid(), :'prog_id', 'ac', '40', 'PATANCHERU', now());
   ```
   **Expect:** `ERROR: A ac must have a pc as its parent`. Type `\q` to leave
   (nothing was saved except the demo organization and program; run
   `pnpm --filter api db:reset` if you want a clean database).
4. Optional: `pnpm --filter api db:studio` shows the four new tables.

## Pass criteria

- Steps 1 and 2 give the expected results.

## Known issues and notes

- **Partial unique index is a Prisma preview feature** (`partialIndexes`),
  used for "state codes are unique per program". It's stable in Prisma 8;
  the generated SQL is plain PostgreSQL either way.
- **The rules live in database triggers**, so they also apply to raw SQL and
  imports, not just to the API.
- **Nodes can't be moved.** If a part was put under the wrong AC, delete it
  (while it has no data) and create it again. Real ECI boundaries don't move
  between revisions.
