# BoothConnect roll-parser (Python)

Background worker that reads electoral-roll PDFs and extracts the header,
printed totals and voter rows, each field with a confidence score. The API
hands it `extract-roll` jobs through Redis. Design:
[`docs/design/voter-roll-pdf-import.md`](../../docs/design/voter-roll-pdf-import.md)
and [ADR-0002](../../docs/adr/0002-pdf-roll-extraction.md).

It never extracts or stores voter photos, maps, building photos or GPS
positions, and its logs never contain personal data. Real roll PDFs are never
committed; tests use synthetic PDFs.

## Requirements

- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 and the packages)
- [Tesseract 5](https://tesseract-ocr.github.io/) with the English language
  pack (Telugu later). On Windows, set `TESSERACT_CMD` if it isn't on `PATH`.

Or skip both and use the Docker image (see below). Setup steps for Windows are
in [`docs/SETUP.md`](../../docs/SETUP.md#6-roll-parser-python-optional).

## Commands

```powershell
pnpm --filter roll-parser setup        # uv sync: create .venv, install packages
pnpm --filter roll-parser check        # show Tesseract/PyMuPDF/OpenCV versions
pnpm --filter roll-parser lint         # ruff check + ruff format --check
pnpm --filter roll-parser format       # apply ruff format and safe fixes
pnpm --filter roll-parser typecheck    # mypy --strict
pnpm --filter roll-parser test         # pytest
```

Inside `apps/roll-parser` you can call the tools directly, for example
`uv run pytest -k ocr` or `uv run roll-parser check`.

### Docker

```powershell
docker compose -f infra/docker-compose.yml --profile roll-parser build roll-parser
docker compose -f infra/docker-compose.yml --profile roll-parser run --rm roll-parser check
```

The service has the `roll-parser` profile, so `pnpm infra:up` doesn't start it.
The image is Ubuntu 24.04 with Python 3.12 and Tesseract 5.3.4 (English and
Telugu), the same versions as the CI runner, and runs as a non-root user.

## Layout

| Path                     | What it holds                                                    |
| ------------------------ | ---------------------------------------------------------------- |
| `src/roll_parser/cli.py` | `roll-parser` command line                                       |
| `src/roll_parser/ocr.py` | Tesseract wrapper (`TESSERACT_CMD`, languages, one-line OCR)     |
| `tests/`                 | pytest tests                                                     |
| `Dockerfile`             | Worker image: Ubuntu 24.04, Python 3.12, Tesseract 5 (eng + tel) |

## Environment variables

| Variable        | Default             | Meaning                               |
| --------------- | ------------------- | ------------------------------------- |
| `TESSERACT_CMD` | `tesseract` on PATH | Full path to the Tesseract executable |
