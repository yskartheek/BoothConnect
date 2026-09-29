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

## Geography (#103)

`/geography` has two parts:

- **Upload master data:** download the template
  (`public/templates/geography-master.csv`, a copy of
  `docs/templates/geography-master.csv` that a test keeps identical). Pick a
  filled CSV and **Check file**: the API returns each row's result (add,
  update, no change, error with reasons) without saving. When there are no
  errors, **Save N changes** confirms it.
- **Current hierarchy:**
  - The admin's States, PCs and ACs are loaded together. A search keeps the
    matches and the path down to them.
  - **Edit** changes a name or reservation. Only changed fields are sent, so
    the audit log is exact.
  - Parts and polling stations load when an AC or part is opened. They are
    read-only and labelled "From roll imports".

## Users and assignments (#176)

`/users` manages the people of the admin's area, through `/v1/users` and
`/v1/role-assignments`:

- **The list** shows each person's active roles in the area, 50 at a time
  (**Show more** follows `nextCursor`). Filters: area or booth, role, name or
  phone (`q`), and "Only people with an active role" (on by default).
- **Place pickers** (`components/area-picker.tsx`) are cascading
  dropdowns. The first lists the admin's own admin nodes from `/v1/me`, and
  each choice adds the level below, down to polling stations. Nothing
  outside the admin's area is offered.
- **Open** shows a person's role history in the area. **Give a role** and
  **Add a user** check the obvious rules first: volunteers go on a polling
  station, and the end date comes after the start. The API's 422 messages are
  shown as they are.
- **End role** asks for confirmation first. It isn't offered on the admin's
  own admin role, which the API refuses.
- Browser tests check the page with axe (`e2e/axe.ts`): no serious or
  critical WCAG 2.1 A/AA violations.

## Roll imports (#71)

`/imports` is a wizard: Choose level → Upload → Extract → Review → Confirm.
The batch and step are in the address (`/imports?batch=<id>&step=upload`),
so a reload or a shared link comes back to the same import.

- **Choose level:** the place picker, stopping at Part (`deepest="part"`).
  Long lists get a search box, and `PlaceBreadcrumb` shows the path from the
  State. **Continue** opens a batch (`POST /v1/imports/batches`).
- **Upload** (`components/imports/upload-files.tsx`):
  - `upload-rules.ts` checks the files first: one PDF at Part level, PDFs or
    ZIPs above it, sizes, and files already listed.
  - Upload links come from `POST /v1/imports/batches/:id/files`, 50 files per
    request.
  - `lib/upload.ts` PUTs each 16 MiB part straight to storage with
    XMLHttpRequest, for progress. A failed part is retried after 1, 2, 4 and
    8 s, once the browser is back online. **Retry** continues from the parts
    already sent, and expired links start the file again.
  - `complete` returns each PDF's status. A duplicate shows "Already
    imported".
- **Storage CORS:** browsers upload straight to the imports bucket. Its CORS
  rules must allow `PUT` from the portal's origin and expose the `ETag`
  header. For S3, for example:
  ```json
  [
    {
      "AllowedOrigins": ["https://admin.example.org"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"]
    }
  ]
  ```
  Local MinIO allows any origin and exposes `ETag`.

### Extraction progress (#72)

The **Extract** step (`components/imports/batch-progress.tsx`) lists every
file of the batch from `GET /v1/imports/batches/:id`:

- **Columns:** part (**New** when it will be created), status, pages,
  voters, quality, and totals ✓/✗ (`totalsMatch`).
- **Rejections:** rejected and failed files show the API's reason.
- **Polling:** the page asks again every 3 s while a file is `uploaded`,
  `extracting` or `confirming`, and stops when none is.
- **Filtering and paging:** filter by status; 50 rows at a time.
- **Review** links to `?step=review&file=<id>` (#73).
- **Confirm all ready files** counts only `ready` files and asks first. It
  calls `POST /v1/imports/batches/:id/confirm` and lists any file the API
  skipped, with the reason.

### Review, correct and confirm (#73)

`?step=review&file=<id>` (`components/imports/file-review.tsx`) shows one
file from `GET /v1/imports/files/:id/preview`:

- **What confirming does:** the part and stations to be created or kept, and
  a new revision if there is one. Also the cover page as read, and the totals
  check (printed, as read, now and the difference, by gender).
- **Rows:** filtered by status or low confidence (below 0.6, not corrected),
  50 at a time. Low-confidence cells are highlighted, corrected ones are
  italic, and each row shows its open messages.
- **Correction** (`review-rows.tsx`):
  - The voter page image (`/api/v1/imports/files/:id/pages/:n`, passed on
    `private, no-store`) sits next to the fields, each showing its value as
    read.
  - `PATCH …/rows/:rowId` sends only the changed fields. Rows can be rejected
    with a reason, or restored.
- **Download rejections CSV** links to `…/rejections.csv`.
- **Confirm this file:**
  - The dialog states `willCommit` (voters and households) and the part. A
    totals mismatch must be acknowledged (`acceptTotalsMismatch`).
  - The page then moves to `step=confirm` and follows the commit.
  - When done, it links to `/analytics?node=<part>` (#74).
