# Developer setup (Windows)

This gets you from a fresh Windows machine to a running API
(`http://localhost:4000/v1/health`), admin web and mobile app. Commands are for
**Windows PowerShell**; they work the same in Git Bash, macOS and Linux unless
noted.

Budget about an hour for the first time, mostly downloads.

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
Use the filtered commands in step 3, because `pnpm lint` and `pnpm test` at the
root include the mobile app. The same goes for the Python roll-parser: it needs
uv and Tesseract ([section 6](#6-roll-parser-python-optional)).

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

`pnpm dev` at the root starts the API and the admin web together.

## 3. Everyday commands

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

## 4. Local services

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

## 5. Troubleshooting

- **`port is already allocated` / `address already in use`:** another program
  uses the port, often a local PostgreSQL on 5432. Change `POSTGRES_PORT` in
  `.env` (and the port in `DATABASE_URL`), then `pnpm infra:up` again. For the
  API, change `API_PORT` and `NEXT_PUBLIC_API_BASE_URL`.
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

## 6. Roll parser (Python, optional)

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

### Troubleshooting

- **`Tesseract not found`:** Tesseract isn't on `PATH` and `TESSERACT_CMD`
  isn't set (or points to the wrong file). See step 2.
- **`uv` is not recognized:** reopen PowerShell after installing uv.
- **The root `pnpm lint` / `pnpm test` fail in `@boothconnect/roll-parser`
  and you don't work on it:** leave it out with
  `pnpm turbo run lint test --filter=!@boothconnect/roll-parser`.

## 7. Where to go next

- `docs/IMPLEMENTATION_PLAN.md`: what's being built, and in what order
- `docs/adr/`: architecture decisions, starting with
  [ADR-0001: Technology stack](adr/0001-technology-stack.md)
- `docs/manual-testing/`: step-by-step checks for each issue
- `apps/*/README.md`: details for each app
