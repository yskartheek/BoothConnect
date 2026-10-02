# Developer setup (Windows)

This gets you from a fresh Windows machine to a running API
(`http://localhost:4000/v1/health`), admin web and mobile app. Commands are for
**Windows PowerShell**; they work the same in Git Bash, macOS and Linux unless
noted.

Budget about an hour for the first time, mostly downloads. At the end,
[section 4](#4-demo-an-offline-visit-synced) walks through the demo: a
volunteer records a visit offline on the phone, and it reaches the server
when the phone is back online.

**Contents:** [1. Prerequisites](#1-prerequisites-one-time) ·
[2. First run](#2-first-run) ·
[3. Seed data and signing in](#3-seed-data-and-signing-in) ·
[4. Demo](#4-demo-an-offline-visit-synced) ·
[5. Running each app](#5-running-each-app) · [6. Tests](#6-tests) ·
[7. Everyday commands](#7-everyday-commands) ·
[8. Local services](#8-local-services) ·
[9. Troubleshooting](#9-troubleshooting) ·
[10. Roll parser](#10-roll-parser-python-optional) ·
[11. Where to go next](#11-where-to-go-next)

## 1. Prerequisites (one time)

| Tool                                  | Version                  | Needed for          |
| ------------------------------------- | ------------------------ | ------------------- |
| Git                                   | any recent               | everything          |
| Node.js                               | **24 LTS** (24.11+)      | API, web, tooling   |
| pnpm (through corepack)               | pinned in `package.json` | API, web, tooling   |
| Docker Desktop with the WSL 2 backend | any recent               | Postgres, Redis, S3 |
| Flutter SDK                           | stable (3.47+)           | mobile app          |
| Android Studio                        | any recent               | Android emulator    |

1. **Git:** install from https://git-scm.com/download/win. Keep the default
   line-ending option; the repo's `.gitattributes` enforces LF.
2. **Node.js 24 LTS:** install from https://nodejs.org, or with
   [nvm-windows](https://github.com/coreybutler/nvm-windows):
   ```powershell
   nvm install 24
   nvm use 24
   ```
   The repo's `.nvmrc` says 24.
3. **pnpm:** turn on corepack, which installs the exact pnpm version the repo
   pins. If it fails with a permissions error, run PowerShell **as
   Administrator** once.
   ```powershell
   corepack enable
   ```
4. **Docker Desktop:** install from https://www.docker.com/products/docker-desktop/
   and choose the **WSL 2** backend when asked (Settings → General → "Use the
   WSL 2 based engine"). Start it and wait for **Engine running**.
5. **Flutter:** follow https://docs.flutter.dev/get-started/install/windows/mobile
   (stable channel) and add `flutter\bin` to your `PATH`.
6. **Android Studio:** install from https://developer.android.com/studio. In
   **SDK Manager** install an Android SDK platform and **Android SDK
   Command-line Tools**; in **Device Manager** create a virtual device.
7. Check everything:
   ```powershell
   git --version
   node -v                             # v24.11 or newer
   pnpm -v                             # the version in package.json
   docker version                      # shows both Client and Server
   flutter doctor --android-licenses   # accept all
   flutter doctor                      # Flutter, Android toolchain, Android Studio OK
   ```
   `flutter doctor` may complain about Visual Studio or Chrome; those aren't
   needed here.

**Only working on the API or web?** You can skip Flutter and Android Studio.
Use the filtered commands in [section 6](#6-tests), because `pnpm lint` and
`pnpm test` at the root include the mobile app. The same goes for the Python
roll-parser: it needs uv and Tesseract
([section 10](#10-roll-parser-python-optional)).

## 2. First run

```powershell
git clone https://github.com/yskartheek/BoothConnect.git
cd BoothConnect
pnpm install --frozen-lockfile
Copy-Item infra/env/.env.example .env      # local settings; never committed
pnpm infra:up                              # Postgres, Redis, MinIO
```

`pnpm infra:up` ends with `Bucket boothconnect-imports is ready` once all three
services are healthy. The first run downloads the Docker images.

Create the database tables:

```powershell
pnpm --filter api db:deploy
pnpm --filter api db:seed       # synthetic demo data; safe to run again
```

Start the API:

```powershell
pnpm --filter api dev
```

When the log shows `API listening on http://localhost:4000/v1`, open
http://localhost:4000/v1/health. You should see:

```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "up", "latencyMs": 1 },
    "redis": { "status": "up", "latencyMs": 0 }
  }
}
```

That's the setup done. The other apps:

```powershell
pnpm --filter admin-web dev     # admin web on http://localhost:3000
pnpm --filter mobile start      # Flutter app; start the Android emulator first
```

`pnpm dev` at the root starts the API and the admin web together. More in
[section 5](#5-running-each-app).

## 3. Seed data and signing in

`db:seed` loads synthetic demo data only (made-up names, no real voter data):

- one state (`S99`) → PC `1` → AC `101` → two parts, **Demo Nagar** (part 1)
  and **Sample Colony** (part 2), with polling stations `1` (and its
  auxiliary station `1A`, for section 2) and `2`;
- 20 households and 60 voters per part;
- the field definitions: caste/community is behind consent; religion and
  political affiliation are present but turned off.

| Who                  | Phone           | Can see                                   | Uses       |
| -------------------- | --------------- | ----------------------------------------- | ---------- |
| **Demo Admin**       | `+919999900001` | everything in the state                   | admin web  |
| **Demo Volunteer A** | `+919999900002` | polling station 1 (part 1, Demo Nagar)    | mobile app |
| **Demo Volunteer B** | `+919999900003` | polling station 2 (part 2, Sample Colony) | mobile app |

There are no passwords. You sign in with a phone number and a 6-digit code.
With `OTP_DEV_MODE=true` (the default in `.env.example`), no SMS is sent.
The code appears in the **API's window**:

```text
WARN (12345): Development sign-in code for +919999900002: 123456
```

A code lasts 5 minutes. A phone can ask for 3 codes in 10 minutes: after
that, wait or use another seed user. The admin web shows a two-step
verification page after the code; it's a placeholder, so continue.

## 4. Demo: an offline visit, synced

This is the whole stack working together: a volunteer records a visit with
no connection, closes the app, and the visit reaches the server once the
phone is back online.

1. **API:** with `pnpm infra:up` done and the database seeded (section 2):
   ```powershell
   pnpm --filter api dev
   ```
   Wait for `API listening on http://localhost:4000/v1`.
2. **Emulator:** in Android Studio, **Device Manager → ▶** on your virtual
   device. Wait for its home screen.
3. **App:** in a second PowerShell window, from the repo folder:
   ```powershell
   pnpm --filter mobile start
   ```
   The first build takes several minutes. The app opens on the emulator and
   talks to the API on your computer at `http://10.0.2.2:4000` (the
   emulator's address for your computer).
4. **Sign in** as Demo Volunteer A: type `9999900002` (the app adds `+91`),
   tap **Send code**, and type the code from the API window.
   **Expect:** Home, with "Demo Primary School, Room 1, booth 1" and how
   many of its households are visited.
5. **Go offline:** on the emulator, swipe down from the top and turn on
   **Airplane mode**.
   **Expect:** "You're offline" at the top of the app.
6. **Record a visit:** **Households** → any household → **Start visit** →
   **No one home** → **Save visit**.
   **Expect:** "Visit saved. It uploads when you're online."; the household
   shows **On phone**, and Home shows "Waiting to upload: 1".
7. **Restart the app:** open the emulator's recent apps (the square
   button), swipe BoothConnect away, then open it again from the app
   drawer.
   **Expect:** still signed in, and still "Waiting to upload: 1".
8. **Back online:** turn **Airplane mode** off.
   **Expect:** within a few seconds the household shows **Uploaded**, and
   **Uploads** says "Online · everything uploaded".
9. **On the server:** start the admin web (`pnpm --filter admin-web dev`),
   sign in at http://localhost:3000 as Demo Admin, and open **Audit**.
   **Expect:** a `visit.create` event by Demo Volunteer A.

The same flow runs automatically in the mobile test suite
(`apps/mobile/test/e2e/offline_sync_test.dart`).

## 5. Running each app

| App                | Command                                       | Notes                                                                                                                                                                     |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker services    | `pnpm infra:up`                               | Postgres, Redis and MinIO. Needed by everything else.                                                                                                                     |
| Database           | `pnpm --filter api db:deploy`, then `db:seed` | After pulling new migrations, run `db:deploy` again. `db:studio` opens Prisma Studio to browse the data.                                                                  |
| API (development)  | `pnpm --filter api dev`                       | Reloads on change. Swagger UI at http://localhost:4000/v1/docs. The API guide is [`docs/api/README.md`](api/README.md).                                                   |
| API (built)        | `pnpm --filter api build`, then `start`       | What a server runs. With `NODE_ENV=production`, Swagger UI is off and production settings are required.                                                                   |
| Roll-parser worker | `pnpm --filter roll-parser worker`            | Reads the roll PDFs uploaded in the admin web. Without it, uploaded files stay "Extracting". Setup in [section 10](#10-roll-parser-python-optional), or run it in Docker. |
| Admin web          | `pnpm --filter admin-web dev`                 | http://localhost:3000. Talks to the API at `API_URL` (default `http://localhost:4000`).                                                                                   |
| Mobile, emulator   | `pnpm --filter mobile start`                  | Start the emulator first. Uses `http://10.0.2.2:4000`.                                                                                                                    |
| Mobile, real phone | see below                                     | USB debugging on, phone plugged in.                                                                                                                                       |

**On a real Android phone,** the phone can't reach `10.0.2.2`. Either
forward the port over USB, so the phone's `localhost:4000` is your
computer's:

```powershell
adb reverse tcp:4000 tcp:4000
flutter run --dart-define=API_BASE_URL=http://localhost:4000   # in apps/mobile
```

or use your computer's Wi-Fi address (`ipconfig` → IPv4 Address), with the
phone on the same network and port 4000 allowed through Windows Firewall:

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:4000   # your address
```

Development builds allow plain `http`; release builds need `https`.

**Other admin tasks:**

- `pnpm --filter api admin:grant --phone +919876543210 --name "Your Name" --node S99`
  makes someone an admin (after `pnpm --filter api build`).
- `pnpm --filter api stats:rebuild` recomputes every area's analytics (after
  a build).

## 6. Tests

CI runs all of these on every pull request (`.github/workflows/ci.yml`).

| Suite                          | Command                                                                                       | Needs                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Everything (lint, types, unit) | `pnpm lint`, `pnpm typecheck`, `pnpm test`                                                    | Flutter and the roll-parser setup, or filter them out                                                    |
| Formatting                     | `pnpm format:check` (fix: `pnpm format`)                                                      | —                                                                                                        |
| API unit + e2e                 | `pnpm --filter api test`                                                                      | nothing (no Docker)                                                                                      |
| API integration                | `pnpm --filter api test:int`                                                                  | `pnpm infra:up`. Uses its own databases, never your dev data.                                            |
| API spec up to date            | `pnpm --filter api openapi:check`                                                             | —                                                                                                        |
| Admin web unit                 | `pnpm --filter admin-web test`                                                                | —                                                                                                        |
| Admin web in the browser       | `pnpm test:e2e`                                                                               | Playwright's browser, once: `pnpm --filter admin-web exec playwright install chromium`. Uses a mock API. |
| Mobile                         | `pnpm --filter mobile lint`, then `pnpm --filter mobile test`                                 | Flutter. Includes the offline → sync end-to-end test.                                                    |
| Roll parser                    | `pnpm --filter roll-parser test` (and `test:int`)                                             | uv and Tesseract, or Docker (section 10)                                                                 |
| Shared packages                | `pnpm --filter @boothconnect/i18n test`, `…/design-tokens`, `…/api-client`, `…/eslint-config` | —                                                                                                        |

Not working on mobile or the roll parser? Leave them out:

```powershell
pnpm turbo run lint typecheck test --filter=!@boothconnect/mobile --filter=!@boothconnect/roll-parser
```

## 7. Everyday commands

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm infra:up` / `pnpm infra:down` | Start / stop the Docker services (data is kept)                        |
| `pnpm infra:logs`                   | Follow the service logs                                                |
| `pnpm infra:reset`                  | Stop the services and **delete their data**                            |
| `pnpm dev`                          | API + admin web with reload                                            |
| `pnpm lint` / `typecheck` / `test`  | All checks for all apps (needs Flutter for mobile)                     |
| `pnpm format` / `pnpm format:check` | Apply / check Prettier formatting                                      |
| `pnpm build`                        | Production builds of the API and admin web                             |
| `pnpm test:e2e`                     | Browser tests for the admin web                                        |
| `pnpm --filter api test:int`        | API integration tests (needs `pnpm infra:up`)                          |
| `pnpm --filter api db:deploy`       | Apply database migrations (needs `pnpm infra:up`)                      |
| `pnpm --filter api db:seed`         | Load development seed data                                             |
| `pnpm --filter <app> <script>`      | One app only; `<app>` is `api`, `admin-web`, `mobile` or `roll-parser` |

Run `pnpm format`, `pnpm lint`, `pnpm typecheck` and `pnpm test` before
pushing; CI runs the same checks (see `.github/workflows/ci.yml`).

Before the first `pnpm test:e2e`, download Playwright's browser once:
`pnpm --filter admin-web exec playwright install chromium`.

## 8. Local services

| Service       | Address                    | Credentials (development only)                     |
| ------------- | -------------------------- | -------------------------------------------------- |
| PostgreSQL 16 | `localhost:5432`           | `boothconnect` / `boothconnect`, db `boothconnect` |
| Redis 7       | `localhost:6379`           | none                                               |
| MinIO S3 API  | `http://localhost:9000`    | `boothconnect` / `boothconnect-dev-secret`         |
| MinIO console | `http://localhost:9001`    | same as above                                      |
| API           | `http://localhost:4000/v1` | —                                                  |
| Admin web     | `http://localhost:3000`    | —                                                  |

All of these come from `.env`; every variable is explained in
`infra/env/.env.example`.

## 9. Troubleshooting

- **`port is already allocated` / `address already in use`:** another program
  uses the port, often a local PostgreSQL on 5432. Change `POSTGRES_PORT` in
  `.env` (and the port in `DATABASE_URL`), then `pnpm infra:up` again. For the
  API, change `API_PORT`, and set `API_URL` for the admin web (e.g. in
  `apps/admin-web/.env.local`).
- **`Invalid environment configuration` when starting the API:** `.env` is
  missing or a value is wrong. The message lists each problem. Copy
  `infra/env/.env.example` to `.env` again.
- **`/v1/health` returns 503:** a service is down. Run
  `docker compose -f infra/docker-compose.yml ps` and `pnpm infra:up`.
- **`docker` commands fail with "cannot connect to the Docker daemon":**
  Docker Desktop isn't running.
- **Docker pulls fail with `429 Too Many Requests`:** Docker Hub's rate limit.
  Wait a few minutes or `docker login`.
- **`Unsupported engine` or odd errors from pnpm:** check `node -v` is 24.11 or
  newer and run `corepack enable` again after switching Node versions.
- **Changed Postgres or MinIO credentials in `.env` and they don't apply:**
  they're only read when the data volume is created. `pnpm infra:reset`
  (deletes local data), then `pnpm infra:up`.
- **Flutter build fails in the `sqlite3` hook:** the first build downloads the
  SQLCipher library from GitHub; check your network or proxy.

**WSL 2 and Docker Desktop**

- **Docker Desktop says WSL 2 is missing or too old:** in an Administrator
  PowerShell, `wsl --install` (first time) or `wsl --update`, then restart
  Windows.
- **"Virtualization must be enabled":** turn on virtualization (Intel VT-x
  or AMD-V / SVM) in the BIOS or UEFI settings.
- **Docker uses too much memory:** limit WSL 2 in `%UserProfile%\.wslconfig`:
  ```ini
  [wsl2]
  memory=4GB
  ```
  then `wsl --shutdown` and start Docker Desktop again.
- **Clone inside WSL, or on Windows?** Either works, but not both mixed.
  Run `pnpm install` on the same side you run the apps from:
  `node_modules` built on one side doesn't work on the other.

**Ports**

- **A port is free but still "already in use" or "access is denied":**
  Windows reserves some port ranges for Hyper-V. See them with
  `netsh interface ipv4 show excludedportrange protocol=tcp`, and move the
  service to a port outside those ranges in `.env`.
- **What is using a port:** `Get-NetTCPConnection -LocalPort 5432 | Select-Object OwningProcess`,
  then `Get-Process -Id <that number>`.

**Android emulator and the API**

- **The app can't reach the API** ("Can't reach the server"):
  - Is the API running, and does http://localhost:4000/v1/health work in
    a browser on your computer?
  - The emulator reaches your computer at `10.0.2.2`, not `localhost`.
    In the emulator's Chrome, open http://10.0.2.2:4000/v1/health: it
    should show `"status":"ok"`.
  - Changed `API_PORT`? Run the app with
    `--dart-define=API_BASE_URL=http://10.0.2.2:<port>`.
  - Windows Firewall asked about Node.js? Allow it on **private** networks.
- **A real phone can't reach the API:** use `adb reverse` or your Wi-Fi
  address ([section 5](#5-running-each-app)). `10.0.2.2` only works in the
  emulator.
- **`flutter run` says no devices:** start the emulator first, or check
  the phone with `adb devices` (accept the "Allow USB debugging?" prompt on
  the phone).
- **The emulator is very slow:** in Android Studio's Device Manager, use an
  x86_64 system image, and check that Windows **Hypervisor Platform** is on
  (Windows Features).
- **No code in the API window:** check `OTP_DEV_MODE=true` in `.env` and
  restart the API. After 3 requests in 10 minutes the app says "Too many
  attempts. Wait a moment and try again.": wait, or sign in as another seed
  user.

## 10. Roll parser (Python, optional)

`apps/roll-parser` reads electoral-roll PDFs. You only need this if you work
on it, or want the root `pnpm lint` / `pnpm test` to cover it. There are two
ways to run it.

### Option A: on Windows directly

1. **uv** (installs Python 3.12 and the packages for you):
   ```powershell
   winget install --id=astral-sh.uv -e
   ```
   Close and reopen PowerShell, then `uv --version`.
2. **Tesseract 5:**
   ```powershell
   winget install --id=UB-Mannheim.TesseractOCR -e
   ```
   The installer puts it in `C:\Program Files\Tesseract-OCR` but doesn't add
   it to `PATH`. Either add that folder to `PATH`, or tell the parser where it
   is (for the current window; use System Properties → Environment Variables
   to make it permanent):
   ```powershell
   $env:TESSERACT_CMD = "C:\Program Files\Tesseract-OCR\tesseract.exe"
   ```
   English is included. Telugu, needed later for Telugu rolls, can be ticked
   under "Additional language data" in the installer.
3. Install and check:
   ```powershell
   pnpm --filter roll-parser sync    # creates apps/roll-parser/.venv
   pnpm --filter roll-parser check    # prints the Tesseract, PyMuPDF and OpenCV versions
   pnpm --filter roll-parser test
   ```

### Option B: Docker only

No Python or Tesseract on your machine; Docker Desktop is enough:

```powershell
docker compose -f infra/docker-compose.yml --profile roll-parser build roll-parser
docker compose -f infra/docker-compose.yml --profile roll-parser run --rm roll-parser check
```

`pnpm infra:up` never starts the roll-parser; it has its own compose profile.
To run the **queue worker** in Docker (it connects to the Redis and MinIO
containers):

```powershell
docker compose -f infra/docker-compose.yml --profile roll-parser up -d --build roll-parser
```

Without Docker: `pnpm --filter roll-parser worker` (after `pnpm infra:up`).

### Troubleshooting

- **`Tesseract not found`:** Tesseract isn't on `PATH` and `TESSERACT_CMD`
  isn't set (or points to the wrong file). See step 2.
- **`uv` is not recognized:** reopen PowerShell after installing uv.
- **The root `pnpm lint` / `pnpm test` fail in `@boothconnect/roll-parser`
  and you don't work on it:** leave it out with
  `pnpm turbo run lint test --filter=!@boothconnect/roll-parser`.

## 11. Where to go next

- `docs/IMPLEMENTATION_PLAN.md`: what's being built, and in what order
- `docs/adr/`: architecture decisions, starting with
  [ADR-0001: Technology stack](adr/0001-technology-stack.md)
- `docs/manual-testing/`: step-by-step checks for each issue
- `apps/*/README.md`: details for each app
