# ADR-0004: Geography scope on every request, and 404 for records outside it

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Product owner (yskartheek)
- **Related:** plan §8 (Authorization), #33 #36 #37 #42 #43 #51, `apps/api/src/authz/`

## Context

BoothConnect holds personal data about voters, organised by geography:
State → PC → AC → part → polling station (booth). A volunteer works one booth,
and an admin or campaign manager works an area. A user must never see or
change another area's records, and must not be able to find out that they
exist, even when a record ID reaches them (a shared link, a screenshot).

Two questions had to be decided:

1. **Where** is access enforced: in each query, in a shared layer, or in the
   database?
2. **What** does a caller get for a record outside their area: 403 or 404?

## Decision

**Every request resolves the caller's scope, and every query is limited to
it. A record outside the scope is a 404, exactly like one that doesn't
exist.**

- **Scope, per request.** `GeoScopeGuard` runs on every authenticated
  request, after `JwtAuthGuard`. `ScopeService.resolve` reads the caller's
  active role assignments (started, not ended). Each assignment covers its
  node and everything below it, found through `geography_closure`. The
  result is `Scope { roles, nodeIds, boothIds }`, where `boothIds` is every
  polling station (main and auxiliary) under any assigned node.
- **Roles** are checked by `@Roles(...)`. A role the caller doesn't hold →
  **403 `FORBIDDEN`**. It says what the caller may do, not which records
  exist.
- **Records** are found with the scope in the query
  (`where: { ...inScope(scope), id }`, `scoped-query.ts`). Nothing found →
  **404 `NOT_FOUND`**, whether the record doesn't exist or is outside the
  scope (`foundInScope`, `notFound`).
- **Lists, counts, search, sync and analytics** filter by the scope in the
  query itself, never after loading. A filter naming a booth outside the
  scope matches nothing (an empty list, or a 404), never that booth's data.
- **Writes** find their target the same way, so a write to another booth is
  a 404 and changes nothing. In sync push, each such item is `rejected` with
  `NOT_FOUND`.
- **Sync** fingerprints the scope into its cursor. When a user's
  assignments change, their next pull is a full snapshot, so the phone drops
  what they can no longer see.
- **Tests:** `apps/api/test/cross-booth.int-spec.ts` signs in as volunteer A
  against booth B on a real Postgres. It checks reads by ID, lists, search,
  sync, writes, sync push and analytics. Its `ROUTES` table lists every
  endpoint, so a new endpoint fails the suite until it's classified.

## Alternatives considered

| Option                                | Why not                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 403 for records outside the scope     | Confirms the record exists. With UUIDs that's a small leak, but IDs travel in screenshots and links; 404 gives nothing away.                                                                                 |
| Check access after loading the record | Easy to forget in one handler, and a list or count filtered after loading leaks totals. Filtering in the query makes "outside the scope" and "doesn't exist" the same code path.                             |
| Postgres row-level security           | Strong, but needs the scope in a session variable on every pooled connection and every transaction. Harder to test and to debug with Prisma. Worth revisiting if more services access the database directly. |
| Cache the scope in the access token   | A revoked assignment would keep working until the token expires (15 min). Resolving per request makes revocation immediate, for one indexed query.                                                           |

## Consequences

- Every new endpoint needs its scoped query, and a row in `ROUTES`. The
  suite fails until it has one, which is the point.
- Callers can't tell "missing" from "not yours". Support uses the request
  ID and the audit log, not the status code.
- Roles and booths are unions across assignments. Someone who is an admin
  in one area and a volunteer in another has the admin role over both
  areas' booths. That's acceptable for Milestone 1, where a user holds one
  role. Per-assignment roles would need the scope to pair roles with nodes.
- Resolving the scope costs one query per request. If it shows up in
  profiles, cache it briefly in Redis, invalidated when assignments change.
- An area admin sees everything below their node, including restricted
  fields, within the rules of ADR-0008.
