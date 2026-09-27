# #14: Shared ESLint + Prettier config

**Issue:** https://github.com/yskartheek/BoothConnect/issues/14
**What changed:**

- New package `packages/eslint-config` (`@boothconnect/eslint-config`) with
  three ESLint 10 flat-config presets: `base`, `nest` and `next`
- Root Prettier setup: `.prettierrc.json`, `.prettierignore`, and the
  `pnpm format` / `pnpm format:check` scripts
- `engines.node` raised to `>=20.19`, because ESLint 10 requires it
- TypeScript pinned to `~6.0`, because typescript-eslint doesn't support
  TypeScript 7 yet

## Steps

1. Check out the branch and install:
   ```powershell
   git checkout claude/issue-14-eslint-prettier
   node -v                          # must be v20.19+ or v22.13+
   pnpm install --frozen-lockfile
   ```
2. Check formatting:
   ```powershell
   pnpm format:check
   ```
   **Expect:** `All matched files use Prettier code style!`
3. Lint and test through Turborepo:
   ```powershell
   pnpm lint
   pnpm test
   ```
   **Expect:** `Tasks: 1 successful, 1 total` for each. The task is the new
   eslint-config package.
4. Optional: see the preset tests one by one:
   ```powershell
   pnpm --filter @boothconnect/eslint-config test
   ```
   **Expect:** `# pass 5` and `# fail 0`.
5. Optional: confirm Prettier really catches problems. Add extra spaces to
   `turbo.json`, run `pnpm format:check` (it should list `turbo.json`), then run
   `pnpm format` to fix it.

## Pass criteria

- Steps 2 and 3 pass with no errors, and `git status` is clean afterwards.

## Known issues and notes

- **The spec and implementation plan are excluded from Prettier.**
  Prettier would only pad their Markdown tables, so they're kept exactly as you
  wrote them. Remove them from `.prettierignore` if you'd like them formatted.
- **Flutter code (`apps/mobile`) is excluded from Prettier.** It's formatted
  with `dart format` (#11).
- **The NestJS preset doesn't enforce `import type`.** Nest reads constructor
  parameter types at runtime to inject dependencies, so type-only imports
  would break it. This is on purpose, and there's a test for it.
- **Node 20.11–20.18 no longer works.** If `pnpm lint` fails with an engine
  error, update Node 20 to the latest patch release (`nvm install 20` on
  nvm-windows). From #9 onwards the repo needs **Node 24 LTS** instead.
- **VS Code:** install the ESLint and Prettier extensions, and set Prettier as
  the default formatter, to get format-on-save.
