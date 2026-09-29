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
| #95                | roll-parser installs; `check` shows Tesseract works (no PDF reading yet)             | Terminal, Docker Desktop  |
| #96                | Generate synthetic roll PDFs and compare them with your real sample                  | Terminal, PDF viewer      |
| #9                 | API starts; `/v1/health` responds in the browser                                     | Browser                   |
| #10, #11           | Empty admin web page and empty Flutter app launch                                    | Browser, Android emulator |
| #26                | Seeded database: State → PC → AC → parts/booths, users, households, voters           | Prisma Studio             |
| #97                | **Read your own roll's cover**: AC/PC/part and printed totals from your sample       | Terminal                  |
| #98                | **Read every voter row** of your sample and compare the counts with the totals       | Terminal                  |
| #99                | roll-parser worker takes jobs from Redis; results and page images appear in MinIO    | Docker Desktop, browser   |
| #29–#33            | Sign in through the API with a dev one-time code and call `/v1/me`                   | curl / Postman / Bruno    |
| #36–#39            | Browse households and voters through the API; check volunteer A can't see booth B    | curl / Postman            |
| #41–#43            | Record a visit and sync through the API; try replays and conflicts                   | curl / Postman            |
| #52                | Swagger UI, so the API can be explored from the browser                              | Browser                   |
| #60–#64            | **First real app screens**: sign in on mobile, browse households                     | Android emulator          |
| #65–#67            | **Core demo**: record a visit offline, reconnect, watch it sync                      | Android emulator          |
| #103, #71–#73      | **PDF roll import** in the browser: master data, pick level, upload, review, confirm | Browser                   |
| #74–#77            | **Analytics explorer** (State → booth), voter record view, audit explorer            | Browser                   |

## Guides

| Issue | Guide                                                                                           | Status          |
| ----- | ----------------------------------------------------------------------------------------------- | --------------- |
| #13   | [Initialize pnpm workspace and Turborepo](13-pnpm-workspace-turborepo.md)                       | Ready to test   |
| #14   | [Shared ESLint + Prettier config](14-eslint-prettier.md)                                        | Ready to test   |
| #15   | [docker-compose for Postgres 16, Redis and MinIO](15-docker-compose.md)                         | Ready to test   |
| #16   | [Environment-variable template (.env.example)](16-env-example.md)                               | Ready to test   |
| #9    | [NestJS API skeleton with health endpoint](9-api-skeleton.md)                                   | Ready to test   |
| #10   | [Next.js admin-web skeleton](10-admin-web-skeleton.md)                                          | Ready to test   |
| #11   | [Flutter mobile skeleton](11-mobile-skeleton.md)                                                | Ready to test   |
| #17   | [GitHub Actions CI](17-ci.md)                                                                   | Ready to test   |
| #12   | [SETUP.md and ADR-001 (technology stack)](12-setup-and-adr.md)                                  | Ready to test   |
| #92   | [Design: PDF roll import + hierarchical analytics](92-pdf-roll-import-design.md)                | Ready to review |
| #18   | [Prisma with UUIDv7 and timestamptz conventions](18-prisma-setup.md)                            | Ready to test   |
| #19   | [Schema: organization, program and geography tree](19-geography-schema.md)                      | Ready to test   |
| #20   | [Schema: users, sessions and role assignments](20-users-sessions-roles.md)                      | Ready to test   |
| #21   | [Schema: roll imports](21-import-schema.md)                                                     | Ready to test   |
| #22   | [Schema: households and voters](22-household-voter.md)                                          | Ready to test   |
| #23   | [Schema: field definitions and values](23-field-values.md)                                      | Ready to test   |
| #95   | [roll-parser scaffold (Python, Docker image, CI job)](95-roll-parser-scaffold.md)               | Ready to test   |
| #96   | [Synthetic roll PDF generator and fixtures](96-synthetic-rolls.md)                              | Ready to test   |
| #24   | [Schema: visits and consent](24-visit-consent.md)                                               | Ready to test   |
| #25   | [Schema: idempotency and audit log](25-idempotency-audit.md)                                    | Ready to test   |
| #26   | [Development seed data](26-seed.md)                                                             | Ready to test   |
| #97   | [Cover and summary page parsing](97-cover-summary-parsing.md)                                   | Ready to test   |
| #98   | [Voter-box extraction with confidence and normalisation](98-voter-boxes.md)                     | Ready to test   |
| #99   | [roll-parser queue worker (extract-roll jobs)](99-queue-worker.md)                              | Ready to test   |
| #27   | [API integration-test harness (a database per test file)](27-integration-harness.md)            | Ready to test   |
| #28   | [Structured error format, request IDs and validation](28-errors-validation.md)                  | Ready to test   |
| #29   | [Sign-in with a one-time code (development)](29-otp-sign-in.md)                                 | Ready to test   |
| #30   | [Access tokens, refresh rotation and logout](30-tokens-refresh-logout.md)                       | Ready to test   |
| #31   | [Suspended users lose access immediately](31-suspended-users.md)                                | Ready to test   |
| #32   | [GET /v1/me: profile and active assignments](32-me.md)                                          | Ready to test   |
| #33   | [Geographic scope: users only see their own booths](33-geo-scope.md)                            | Ready to test   |
| #34   | [Audit log for sign-in and sign-out](34-audit-log.md)                                           | Ready to test   |
| #35   | [Safe retries with an Idempotency-Key](35-idempotency.md)                                       | Ready to test   |
| #36   | [Geography dropdowns (State → PC → AC → Part → Booth)](36-geographies.md)                       | Ready to test   |
| #37   | [Households list (scoped, search, visit status, pages)](37-households-list.md)                  | Ready to test   |
| #38   | [Household details (members and last visit)](38-household-detail.md)                            | Ready to test   |
| #39   | [Member details (official values, current values, history)](39-voter-detail.md)                 | Ready to test   |
| #40   | [Saving member details (edits, conflicts, rejections)](40-field-value-writes.md)                | Ready to test   |
| #41   | [Recording a visit](41-visits.md)                                                               | Ready to test   |
| #42   | [Offline sync, downloading changes (+ visit corrections)](42-sync-pull.md)                      | Ready to test   |
| #112  | [Adding households and members, editing the address and location](112-household-writes.md)      | Ready to test   |
| #113  | [Editing member details and choosing between conflicting values](113-member-edits-conflicts.md) | Ready to test   |
| #53   | [Design tokens (light/dark glass + reduced transparency)](53-design-tokens.md)                  | Ready to test   |
| #54   | [Design tokens as CSS variables in the admin web](54-css-variables.md)                          | Ready to test   |
| #55   | [Design tokens as the Flutter theme (+ opaque glass fallback)](55-flutter-theme.md)             | Ready to test   |
| #56   | [Shared strings package (English + Telugu)](56-i18n.md)                                         | Ready to test   |
| #150  | [Glass follows phone settings (transparency, battery saver)](150-glass-platform-settings.md)    | Ready to test   |
| #43   | [Offline sync, uploading the phone's queue](43-sync-push.md)                                    | Ready to test   |
| #44   | [Roll imports: opening a batch and uploading PDFs or ZIPs](44-import-uploads.md)                | Ready to test   |
| #45   | [Roll imports: reading uploaded PDFs (extraction) and checking them](45-import-extraction.md)   | Ready to test   |
| #46   | [Roll imports: batch progress, preview, page images and row corrections](46-import-review.md)   | Ready to test   |
| #47   | [Roll imports: confirming a file or batch (making it live)](47-import-confirm.md)               | Ready to test   |
| #48   | [Roll imports: downloading the rows to fix as a CSV](48-rejections-csv.md)                      | Ready to test   |
| #102  | [Analytics numbers for every area (node_stats)](102-node-stats.md)                              | Ready to test   |
| #49   | [Analytics API: area summary, children table and revisions](49-analytics-api.md)                | Ready to test   |
| #50   | [Reading the audit log (admins)](50-audit-events.md)                                            | Ready to test   |
| #51   | [Cross-booth authorization test suite](51-cross-booth.md)                                       | Ready to test   |
| #164  | [Audit log: filtering by booth or area](164-audit-area-filter.md)                               | Ready to test   |
| #52   | [API documentation (OpenAPI), Swagger UI and the typed client](52-openapi.md)                   | Ready to test   |
| #100  | [Geography master data: States, PCs and ACs from a CSV](100-geography-master.md)                | Ready to test   |
| #101  | [Auxiliary polling stations: coverage by section or serial range](101-station-coverage.md)      | Ready to test   |
| #161  | [Carrying volunteer data over to the same voter in a new roll revision](161-carry-over.md)      | Ready to test   |
| #173  | [Users and role assignments](173-users-roles.md)                                                | Ready to test   |
| #172  | [Adding an auxiliary polling station by hand](172-add-auxiliary-station.md)                     | Ready to test   |
| #69   | [Admin web shell: layout, navigation, theme, shared states](69-admin-shell.md)                  | Ready to test   |
| #70   | [Admin sign-in: code, MFA placeholder, admins only](70-admin-sign-in.md)                        | Ready to test   |
| #103  | [Admin web: geography master data page](103-geography-page.md)                                  | Ready to test   |
| #176  | [Admin web: Users page](176-users-page.md)                                                      | Ready to test   |
| #71   | [Roll import step 1: choose the level and upload](71-import-upload.md)                          | Ready to test   |
| #72   | [Roll import step 2: batch extraction progress](72-import-progress.md)                          | Ready to test   |
| #75   | [Admin web: voter record view](75-voter-record.md)                                              | Ready to test   |
