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
pnpm --filter roll-parser sync        # uv sync: create .venv, install packages
pnpm --filter roll-parser check        # show Tesseract/PyMuPDF/OpenCV versions
pnpm --filter roll-parser synth        # write synthetic roll PDFs (fake data)
pnpm --filter roll-parser exec uv run roll-parser header <roll.pdf>   # read a roll's header
pnpm --filter roll-parser lint         # ruff check + ruff format --check
pnpm --filter roll-parser format       # apply ruff format and safe fixes
pnpm --filter roll-parser typecheck    # mypy --strict
pnpm --filter roll-parser test         # pytest
```

Inside `apps/roll-parser` you can call the tools directly, for example
`uv run pytest -k ocr` or `uv run roll-parser check`.

### Reading a roll's cover and summary

```powershell
pnpm --filter roll-parser exec uv run roll-parser header C:\path\to\roll.pdf
pnpm --filter roll-parser exec uv run roll-parser header C:\path\to\roll.pdf --json
```

Use the full path to the PDF: `pnpm --filter` runs the command inside
`apps/roll-parser`. The first prints the page kinds, AC/PC/part, the printed totals and any
issues; `--json` prints every field with its raw OCR text and confidence. It
only reads the cover, the summary and the top strip of each page (to classify
it); it never reads voter boxes or the maps/photos page, so the output holds
no voter data.

How it works (`src/roll_parser/extract/`):

1. **Classify pages** (`pages.py`): OCR the top 12% of every page. "Section
   No" → voter page, "ELECTORAL ROLL" → cover, "SUMMARY" → summary; anything
   else is the maps/photos page and is skipped.
2. **Cover** (`cover.py`): render at the page image's own resolution, remove
   table borders (so Tesseract reads the totals table), OCR into lines with
   word confidences, then find each `Label : value`. A value ends at the next
   known label, because OCR often joins two columns into one line.
3. **Summary** (`summary.py`): one row per roll type plus the Total row.
4. **Checks** (`header.py`): every field present and read with confidence
   ≥ 0.6; male + female + third gender = total; the serial range covers the
   total; the summary rows add up to its Total row and to the cover; the
   auxiliary station count matches the list. Errors mean the file needs
   review; warnings are shown but don't block.

Every value is a `Field`: `value` (or `null`), `raw` OCR text, and
`confidence` (the lowest Tesseract word confidence in it, 0–1).

### Synthetic rolls (fake data)

Real rolls can't be committed, so the tests use generated ones in the same
layout (Telangana S29 English): an image-only PDF plus a JSON file with the
ground truth (header, printed totals, summary, and every voter entry with its
page and box position).

```powershell
pnpm --filter roll-parser synth              # all presets, into apps/roll-parser/synthetic-rolls/
pnpm --filter roll-parser synth small        # just one
```

| Preset          | What it is                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `small`         | 5 pages, 42 entries in 2 sections, 1 auxiliary station, deleted/modified entries, third gender, long names. Committed in `tests/fixtures/`. |
| `ac40`          | Shaped like the owner's sample: AC 40, Part 408, 23 pages, 571 electors, 2 sections. Generated during the tests.                            |
| `ac40-degraded` | The same roll, blurred, slightly rotated, noisy and at JPEG quality 60.                                                                     |

Names are a common first name plus a family name made up from syllables;
place names and EPIC numbers are made up too. Every choice comes from a fixed
seed, so the same preset always gives the same roll. Screenshots:
[`docs/synthetic-roll/`](docs/synthetic-roll/).

Assumptions to check against more real samples (see the design, §10): each
section starts on a new page; deleted and modified entries show `DELETED` /
`MODIFIED` where the photo placeholder normally is.

If you change the generator, regenerate the committed fixture (a test fails
until you do):

```powershell
cd apps/roll-parser
uv run roll-parser synth small --out tests/fixtures
git add -f tests/fixtures/small.pdf tests/fixtures/small.json
```

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
