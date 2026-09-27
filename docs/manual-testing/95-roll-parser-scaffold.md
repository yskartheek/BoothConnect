# #95: roll-parser scaffold (Python app, Docker image, CI job)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/95
**What changed:**

- New app `apps/roll-parser`: Python 3.12 managed with `uv` (`pyproject.toml`
  - `uv.lock`), `ruff` for lint and formatting, `mypy --strict`, `pytest`.
    Dependencies: PyMuPDF, OpenCV (headless), pytesseract.
- It doesn't read rolls yet. It has one command, `roll-parser check`, which
  prints the Tesseract, PyMuPDF and OpenCV versions, and smoke tests that
  render text into a PDF page and read it back with Tesseract.
- `apps/roll-parser/package.json` wraps the Python tools (`sync`, `check`,
  `lint`, `format`, `typecheck`, `test`), so `pnpm lint` / `pnpm typecheck` /
  `pnpm test` at the root include it, the same way as the Flutter app.
- `apps/roll-parser/Dockerfile`: Ubuntu 24.04, Python 3.12, Tesseract 5.3.4
  with English and Telugu, runs as a non-root user.
- `infra/docker-compose.yml`: new `roll-parser` service with its own profile.
  `pnpm infra:up` does **not** start it.
- CI: new **Roll parser** job (runs when `apps/roll-parser/**` or the workflow
  changes): installs Tesseract, runs lint, typecheck and tests, then builds the
  Docker image and runs `check` inside it. The JS job now skips the Python app.
- `docs/SETUP.md` section 6: installing uv and Tesseract on Windows, or using
  Docker only.

## Steps

You can do **A** (Windows directly), **B** (Docker only), or both.

### A. On Windows directly

1. Install uv and Tesseract as in `docs/SETUP.md` section 6, then open a new
   PowerShell window in the repo:
   ```powershell
   uv --version
   $env:TESSERACT_CMD = "C:\Program Files\Tesseract-OCR\tesseract.exe"   # unless it's on PATH
   pnpm install --frozen-lockfile
   pnpm --filter roll-parser sync
   ```
   **Expect:** uv downloads Python 3.12 if you don't have it, then
   `Installed ... packages`. A new folder `apps/roll-parser/.venv` appears
   (ignored by git).
2. ```powershell
   pnpm --filter roll-parser check
   ```
   **Expect** something like:
   ```text
   roll-parser 0.0.0
   tesseract   5.x.x (languages: eng, osd)
   pymupdf     1.28.2
   opencv      5.0.0
   ```
   The Tesseract version depends on your installer; it must start with `5.`.
3. ```powershell
   pnpm --filter roll-parser lint
   pnpm --filter roll-parser typecheck
   pnpm --filter roll-parser test
   ```
   **Expect:** `All checks passed!` and `... files already formatted`;
   `Success: no issues found`; `4 passed`.
4. Optional: see the error message without Tesseract.
   ```powershell
   $env:TESSERACT_CMD = "C:\nowhere\tesseract.exe"
   pnpm --filter roll-parser check
   Remove-Item Env:TESSERACT_CMD
   ```
   **Expect:** `Tesseract not found: ...` and a pointer to `docs/SETUP.md`.

### B. Docker only

1. Start Docker Desktop, then:
   ```powershell
   docker compose -f infra/docker-compose.yml --profile roll-parser build roll-parser
   docker compose -f infra/docker-compose.yml --profile roll-parser run --rm roll-parser check
   ```
   **Expect:** the build takes a few minutes the first time, then:
   ```text
   roll-parser 0.0.0
   tesseract   5.3.4 (languages: eng, osd, tel)
   pymupdf     1.28.2
   opencv      5.0.0
   ```
2. ```powershell
   pnpm infra:up
   docker compose -f infra/docker-compose.yml ps
   ```
   **Expect:** postgres, redis and minio only; no roll-parser container.

### C. CI

1. On this PR, open **Checks → CI**.
   **Expect:** the **Roll parser (lint, typecheck, test)** job is green. Its
   log shows `tesseract 5.3.4`, `4 passed`, and the image's `check` output at
   the end.

## Pass criteria

- A3 (or C1) shows `4 passed`, and one of those tests reads text with Tesseract.
- B1 prints Tesseract 5 with `eng` and `tel`.
- `pnpm infra:up` doesn't start the roll-parser.

## Known issues and notes

- **The root `pnpm lint` / `pnpm test` now need uv and Tesseract**, as they
  already need Flutter. If you don't work on the parser, filter it out:
  `pnpm turbo run lint test --filter=!@boothconnect/roll-parser`.
- **Tesseract versions differ slightly** between the Windows installer and the
  Docker image / CI (5.3.4). OCR results can differ by a character on hard
  cases; CI and the Docker image are the reference.
- There is nothing to test on a roll PDF yet. The synthetic roll generator
  comes in #96 and the actual parsing in #97–#98.
