# #13: Initialize pnpm workspace and Turborepo

**Issue:** https://github.com/yskartheek/BoothConnect/issues/13
**What changed:** Root monorepo setup: `package.json` (pnpm pinned through
corepack), `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.editorconfig`,
`.gitignore`, `.gitattributes`, and the empty `apps/`, `packages/`, `infra/`,
`docs/adr/` and `docs/api/` folders.

There is no app to run yet. These steps check that your machine can install and
run the workspace. That's a prerequisite for every later issue.

## Prerequisites (one time)

1. Install **Node.js 24 LTS (24.11 or newer)**: https://nodejs.org
2. Turn on corepack, which provides the pnpm version pinned in `package.json`:
   ```powershell
   corepack enable
   ```
   If this fails with a permissions error, run PowerShell **as Administrator** once.

## Steps

1. Check out the branch and go to the repo root:
   ```powershell
   git fetch origin
   git checkout <PR branch>
   ```
2. Check the versions:
   ```powershell
   node -v      # expect v24.11 or newer
   pnpm -v      # expect 10.33.0 (from packageManager)
   ```
3. Install dependencies using the lockfile:
   ```powershell
   pnpm install --frozen-lockfile
   ```
   **Expect:** `Done in …s`, and `turbo` listed under devDependencies.
4. Run each root script:
   ```powershell
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```
   **Expect:** each one prints `Tasks: 0 successful, 0 total` and exits with no
   error. There are zero tasks because no apps exist yet; later issues add them.
5. Check the folders exist: `apps`, `packages`, `infra`, `docs\adr` and `docs\api`.

## Pass criteria

- Steps 3 and 4 finish without errors.
- `git status` is clean afterwards: `node_modules/` and `.turbo/` are ignored.

## Known issues and notes

- **Line endings on Windows:** `.gitattributes` makes git store files with LF
  line endings. If you cloned before this change and see files that look
  modified, run `git add --renormalize .` once.
- **`corepack enable` on Windows** may need an Administrator shell, because it
  writes pnpm shims next to `node.exe`.
- **Node version:** `engines.node` is `>=24.11` and `.nvmrc` pins 24 for
  nvm-windows users (`nvm install 24`, then `nvm use 24`). It was `>=20.19`
  until #9 raised it: Node 20 reached end of life in April 2026, and the API's
  tests (NestJS 12 with Jest 30) need Node 24.9 or newer.
- The `.gitkeep` files in the empty folders can be deleted once real content
  lands in those folders.
