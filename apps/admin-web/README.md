# @boothconnect/admin-web

Next.js 16 (App Router) admin portal. Runs on http://localhost:3000.

```powershell
pnpm --filter admin-web dev        # development server with hot reload
pnpm --filter admin-web test       # component tests (Vitest + Testing Library)
pnpm --filter admin-web test:e2e   # browser smoke tests (Playwright)
pnpm --filter admin-web build      # production build
pnpm --filter admin-web start      # serve the production build
```

Before the first `test:e2e`, download Playwright's browser once:

```powershell
pnpm --filter admin-web exec playwright install chromium
```

## Layout

| Path                   | What it holds                                                 |
| ---------------------- | ------------------------------------------------------------- |
| `app/`                 | Routes (App Router). `layout.tsx` is the HTML shell           |
| `components/`          | React components, each with a `*.test.tsx` next to it         |
| `e2e/`                 | Playwright tests, run against a real server                   |
| `test/setup.ts`        | Vitest setup (jest-dom matchers, cleanup)                     |
| `playwright.config.ts` | Starts `next dev` locally, or `build` + `start` when `CI` set |

Imports can use `@/` for the app root, e.g. `@/components/welcome-panel`.
