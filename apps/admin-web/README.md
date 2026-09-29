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
| `app/(portal)/`        | The portal's pages, inside the side navigation and top bar    |
| `lib/`                 | API client, session, navigation, appearance and strings       |
| `components/`          | React components, each with a `*.test.tsx` next to it         |
| `e2e/`                 | Playwright tests, run against a real server                   |
| `test/setup.ts`        | Vitest setup (jest-dom matchers, cleanup)                     |
| `playwright.config.ts` | Starts `next dev` locally, or `build` + `start` when `CI` set |

Imports can use `@/` for the app root, e.g. `@/components/welcome-panel`.

## The portal shell (#69)

- **Navigation** (`lib/navigation.ts`): the side menu from spec §9.3.
  Milestone 1 pages are links; later ones are listed, marked "Later", and
  can't be opened. The current page has `aria-current="page"`.
- **Data:** wrap requests in TanStack Query. Get the typed client with
  `apiClient()` from `lib/api.ts`, and pass calls to `unwrap(...)`:
  ```ts
  const me = useQuery({ queryKey: ['me'], queryFn: () => unwrap(apiClient().GET('/v1/me')) });
  ```
  - `unwrap` returns the data or throws an `ApiRequestError` (`status`,
    `code`, `requestId`).
  - Calls go to this server's `/api` (see Sign-in below); a 401 ends the
    session and returns to sign-in.
  - Queries retry server and network errors twice, and never retry 4xx.
- **States** (`components/states.tsx`): `LoadingState`, `EmptyState`,
  `ErrorState` and `DeniedState`. `ErrorState` shows the translated message
  for the error code (`error.<CODE>`) and the request ID, and shows
  `DeniedState` for a 403.
- **Appearance:** the top bar's Appearance button (a Radix popover) sets the
  theme and transparency. The choice is kept in `localStorage`, and an
  inline script applies it before the first paint.
- **Strings** come from `packages/i18n` (`web.*` keys, English and Telugu):
  `t('nav.users')`, `t('state.reference', { requestId })`.
- Styling uses the design tokens (`--bc-*`) in `app/globals.css`. Radix
  primitives come from the `radix-ui` package; there's no Tailwind.

## Sign-in (#70)

The browser never holds a token.

- **Signing in:** `/sign-in` asks for the phone number, then the 6-digit code.
  - The route handlers under `app/auth/` call the API's `/v1/auth/*`, and keep
    the access and refresh tokens in httpOnly, SameSite=Lax cookies (Secure
    on a production build).
  - Only admins get in. Anyone else is signed out again at once and sees
    `/denied`.
- **MFA step:** `/sign-in/mfa` is a placeholder. It lets admins through in
  development, and on a production build only with `ADMIN_MFA_STUB=allow`.
- **Calling the API:** pages call `/api/v1/...` (`apiClient()`).
  - `app/api/[...path]/route.ts` forwards the call to the API with the token.
  - An expired access token is refreshed once. If that fails, the session is
    cleared and the page goes back to sign-in.
  - The API's `/v1/auth/*` routes are not reachable this way.
- **Route guard:** `proxy.ts` sends a signed-out visitor to `/sign-in?next=…`,
  and someone who hasn't done the MFA step to `/sign-in/mfa`. The API still
  checks the token and the role on every request.
- **Settings** (in this app's environment, e.g. `.env.local`):

  | Variable         | Default                 | What it does                                                           |
  | ---------------- | ----------------------- | ---------------------------------------------------------------------- |
  | `API_URL`        | `http://localhost:4000` | Where this server calls the API                                        |
  | `ADMIN_MFA_STUB` | (unset)                 | `allow`: let admins past the MFA placeholder on a production build     |
  | `COOKIE_SECURE`  | (unset)                 | `false`: allow a production build over plain http (local testing only) |

- **Browser tests** (`pnpm test:e2e`) run against `e2e/mock-api.mjs`, a
  stand-in for the API with a synthetic admin and volunteer. The code is
  always `123456`.
