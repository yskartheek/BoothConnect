# Manual testing guide

Each issue gets its own file here: `<issue-number>-<short-name>.md`. It lists
the exact steps to check that issue by hand, what you should see, and the
problems we already know about. Automated tests run in CI; these guides are for
checking things yourself.

Commands are written for **Windows PowerShell** unless noted. They work the
same in Git Bash, macOS and Linux.

## When does manual testing become useful?

Early issues only have small checks (does it install, does it start). The app
becomes clickable later. Use this timeline to decide when to spend time testing.

| After these issues | What you can try yourself                                                            | Tools                     |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------- |
| #13                | Repo installs; root scripts run (nothing to build yet)                               | Terminal                  |
| #15, #16           | Postgres, Redis and MinIO start in Docker; MinIO console opens                       | Docker Desktop, browser   |
| #9                 | API starts; `/v1/health` responds in the browser                                     | Browser                   |
| #10, #11           | Empty admin web page and empty Flutter app launch                                    | Browser, Android emulator |
| #26                | Seeded database: State → PC → AC → parts/booths, users, households, voters           | Prisma Studio             |
| #96–#98            | **Read a roll PDF locally**: run roll-parser on your own sample, compare totals      | Terminal                  |
| #29–#33            | Sign in through the API with a dev one-time code and call `/v1/me`                   | curl / Postman / Bruno    |
| #36–#39            | Browse households and voters through the API; check volunteer A can't see booth B    | curl / Postman            |
| #41–#43            | Record a visit and sync through the API; try replays and conflicts                   | curl / Postman            |
| #52                | Swagger UI, so the API can be explored from the browser                              | Browser                   |
| #60–#64            | **First real app screens**: sign in on mobile, browse households                     | Android emulator          |
| #65–#67            | **Core demo**: record a visit offline, reconnect, watch it sync                      | Android emulator          |
| #103, #71–#73      | **PDF roll import** in the browser: master data, pick level, upload, review, confirm | Browser                   |
| #74–#77            | **Analytics explorer** (State → booth), voter record view, audit explorer            | Browser                   |

## Guides

| Issue | Guide                                                                            | Status          |
| ----- | -------------------------------------------------------------------------------- | --------------- |
| #13   | [Initialize pnpm workspace and Turborepo](13-pnpm-workspace-turborepo.md)        | Ready to test   |
| #14   | [Shared ESLint + Prettier config](14-eslint-prettier.md)                         | Ready to test   |
| #15   | [docker-compose for Postgres 16, Redis and MinIO](15-docker-compose.md)          | Ready to test   |
| #16   | [Environment-variable template (.env.example)](16-env-example.md)                | Ready to test   |
| #9    | [NestJS API skeleton with health endpoint](9-api-skeleton.md)                    | Ready to test   |
| #10   | [Next.js admin-web skeleton](10-admin-web-skeleton.md)                           | Ready to test   |
| #11   | [Flutter mobile skeleton](11-mobile-skeleton.md)                                 | Ready to test   |
| #17   | [GitHub Actions CI](17-ci.md)                                                    | Ready to test   |
| #12   | [SETUP.md and ADR-001 (technology stack)](12-setup-and-adr.md)                   | Ready to test   |
| #92   | [Design: PDF roll import + hierarchical analytics](92-pdf-roll-import-design.md) | Ready to review |
| #18   | [Prisma with UUIDv7 and timestamptz conventions](18-prisma-setup.md)             | Ready to test   |
