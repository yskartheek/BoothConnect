# ADR-0001: Technology stack

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** project owner, with the implementation plan review
- **Related:** `VOTER_FIELD_OPERATIONS_APP_SPEC.md` (§23), `docs/IMPLEMENTATION_PLAN.md`, Epic #1

## Context

BoothConnect has three clients of one backend:

- a **mobile app** for field volunteers that must keep working offline for
  hours, store sensitive voter data encrypted on the device, and sync safely
  when the connection returns (Android first, iOS as well);
- an **admin web portal** for imports, progress tracking, record review and
  audit;
- a **REST API** that enforces geography-scoped authorization, idempotent
  sync, an append-only audit trail and background jobs (imports, exports).

The spec asks for a production-oriented monorepo with an OpenAPI contract. The
team is small, so one language across the API and web, strong typing, and
well-known frameworks matter more than raw performance. Development happens on
Windows, so everything must run there (Docker Desktop with WSL 2 for services).

## Decision

| Layer            | Choice                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Mobile           | **Flutter** (Dart), Riverpod, go_router, Drift on SQLCipher                                         |
| Admin web        | **Next.js** (App Router) with React and TypeScript                                                  |
| API              | **NestJS** with TypeScript, REST under `/v1`, OpenAPI                                               |
| ORM / migrations | **Prisma** (raw SQL only where Prisma can't express it, e.g. the audit table's append-only trigger) |
| Database         | **PostgreSQL 16**                                                                                   |
| Jobs / cache     | **Redis 7** (queues for imports, exports, notifications)                                            |
| Object storage   | S3-compatible; **MinIO** locally                                                                    |
| Repo and tooling | pnpm workspaces + Turborepo, ESLint + Prettier, GitHub Actions                                      |

### Why these

- **Flutter:** one codebase for Android and iOS with native performance, a
  mature offline story (Drift/SQLite with SQLCipher encryption,
  `flutter_secure_storage` for keys), good low-end Android support, and strong
  localization tooling for regional languages.
- **Next.js:** the most widely used React framework, with routing, server
  rendering and build tooling included; it shares TypeScript, lint config and
  the generated API client with the rest of the monorepo.
- **NestJS:** gives the API a clear structure (modules, guards, interceptors)
  that maps directly to the plan's cross-cutting pieces (`GeoScopeGuard`,
  idempotency and audit interceptors), first-class OpenAPI generation, and
  TypeScript end to end.
- **Prisma:** typed queries and a simple migration workflow; the few things it
  can't do (triggers, some constraints) go in raw SQL migrations.
- **PostgreSQL 16:** relational integrity for voters, households and
  assignments; JSONB for import mappings and policy config; row-level security
  and triggers available for defence in depth and the append-only audit log.
- **Redis:** the standard backing store for Node job queues, and useful later
  for rate limiting and short-lived OTP state.

## Alternatives considered

| Area     | Option                     | Why not                                                                                                                                          |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mobile   | React Native               | Would share TypeScript, but its offline-database and encryption options are less mature, and performance on low-end Android is less predictable. |
| Mobile   | Native Kotlin + Swift      | Two codebases for a small team.                                                                                                                  |
| Mobile   | PWA                        | Unreliable background sync, storage eviction and weaker device-level encryption, especially on iOS.                                              |
| Web      | Vite + React SPA           | Viable; Next.js gives routing, layouts and production defaults with less setup.                                                                  |
| API      | Express / Fastify directly | Less structure; guards, interceptors and OpenAPI would be hand-built.                                                                            |
| API      | Django / Rails / Go        | A second server language next to the TypeScript web app, and no shared types with the API client.                                                |
| ORM      | TypeORM / MikroORM         | Weaker type safety (TypeORM) or a smaller community (MikroORM).                                                                                  |
| ORM      | Drizzle / Kysely           | Good typed-SQL options; Prisma's migration workflow and ecosystem won for a small team.                                                          |
| Database | MySQL                      | Weaker JSONB and row-level security support.                                                                                                     |
| Database | MongoDB                    | The data is relational (geography tree, assignments, voters) and needs transactions and constraints.                                             |
| Jobs     | PostgreSQL-based queue     | Possible (e.g. pg-boss), but Redis-backed queues are the common NestJS path and keep load off the main database.                                 |

## Supporting decisions made during scaffolding (Epic 1)

- **Node.js 24 LTS** (`engines.node >=24.11`). Node 20 reached end of life in
  April 2026, and Jest needs Node 24.9+ to load NestJS 12's ES modules (#9).
- **NestJS 12 with Jest**, as in Nest's own project template and the
  implementation plan (Vitest is used for the web app).
- **TypeScript 6.0**, pinned below 7 until typescript-eslint supports 7 (#14).
- **MinIO community fork** (`pgsty/minio`, `pgsty/mc`) for local S3, because
  the official `minio/minio` images are no longer published (#15). Only local
  development uses it; production can use any S3-compatible service.
- **SQLCipher through `sqlite3` 3.x build hooks** (`hooks.user_defines`),
  because `sqlcipher_flutter_libs` is end of life (#11).
- **zod** for environment validation and **pino** for structured logs in the
  API (#9).

## Consequences

- Two languages overall: TypeScript (API, web, tooling) and Dart (mobile).
  API types reach the mobile app through the OpenAPI contract, not shared code.
- The OpenAPI document becomes the contract between the API and both clients,
  so it must be generated and checked in CI once endpoints exist.
- Developers need Node 24, Docker Desktop, Flutter and Android Studio; setup
  is documented in `docs/SETUP.md`.
- Prisma's limits (triggers, RLS policies) mean some migrations are raw SQL
  and need their own tests.
- Revisit if offline sync or on-device encryption hits Flutter limits, if job
  volume outgrows Redis queues, or if Prisma blocks a needed database feature.
