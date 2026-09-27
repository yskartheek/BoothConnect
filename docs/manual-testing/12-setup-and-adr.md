# #12: SETUP.md and ADR-001 (technology stack)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/12
**What changed:**

- `docs/SETUP.md`: Windows prerequisites, first run up to a working
  `/v1/health`, everyday commands, local service addresses and
  troubleshooting
- `docs/adr/0001-technology-stack.md`: why Flutter, Next.js, NestJS, Prisma,
  PostgreSQL and Redis, the alternatives considered, and the decisions made
  while scaffolding (Node 24, the MinIO fork, SQLCipher through `sqlite3`
  hooks, and so on)
- `docs/adr/0000-template.md` and `docs/adr/README.md` (an index of ADRs)
- A short root `README.md` that points to the docs
- The empty `.gitkeep` files in `apps/`, `infra/` and `docs/adr/` are removed,
  because those folders have content now

## Steps

This checks the issue's acceptance criterion: a new developer can follow
SETUP.md to reach a running `/v1/health`. It works best in a **fresh clone**,
so it doesn't reuse anything from your usual working copy.

1. Clone into a new folder and check out the branch:
   ```powershell
   cd $env:USERPROFILE
   git clone https://github.com/yskartheek/BoothConnect.git BoothConnect-setup-test
   cd BoothConnect-setup-test
   git checkout claude/issue-12-setup-adr
   ```
2. Stop your usual services first, so the ports are free: in your normal
   working copy run `pnpm infra:down`, and stop any running `pnpm dev`.
3. Open `docs/SETUP.md` and follow **section 1** (check your tools) and
   **section 2** (first run) exactly as written, skipping the `git clone` line.
   **Expect:** `pnpm infra:up` ends with `Bucket boothconnect-imports is
ready`, and http://localhost:4000/v1/health shows `"status":"ok"`.
4. Try `pnpm dev` from section 2.
   **Expect:** both http://localhost:4000/v1/health and
   http://localhost:3000 respond. Stop it with Ctrl+C.
5. Read `docs/adr/0001-technology-stack.md`.
   **Expect:** it matches your understanding of the decisions. Note anything
   you disagree with in the PR.
6. Clean up:
   ```powershell
   pnpm infra:down
   cd ..
   Remove-Item -Recurse -Force BoothConnect-setup-test
   ```
   Both copies use the same Docker volumes (the Compose project is called
   `boothconnect` in both), so no data is lost.

## Pass criteria

- Steps 3 and 4 work using only what SETUP.md says. Anything missing or
  unclear counts as a failure; please note it in the PR.

## Known issues and notes

- **The issue said Node 20; SETUP.md says Node 24.** Node 20 is end of life,
  and the API tests need Node 24.9+ (#9). ADR-0001 records this.
- **The ADR describes Prisma, which isn't installed yet.** It arrives with the
  database schema work (Epic 2).
- **Checked on Linux, not on Windows.** In the development container, a fresh
  clone following section 2 reached `"status":"ok"` and `pnpm dev` served both
  apps. The Windows-specific parts (nvm-windows, Docker Desktop, Android
  Studio) are what this manual check is for.
