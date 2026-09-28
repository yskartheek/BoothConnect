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
pnpm --filter roll-parser exec uv run roll-parser extract <roll.pdf>  # read every voter row
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
   word confidences, then find each `Label : value` (the revision table has
   no colons). A value ends at the next known label, because OCR often joins
   two columns into one line; a label with nothing after it takes the value
   on the next line, and wrapped values are joined. The labels match the
   owner's 2026 sample cover.
3. **Summary** (`summary.py`): one row per roll type plus the Total row.
4. **Checks** (`header.py`): every field present and read with confidence
   ≥ 0.6; male + female + third gender = total; the serial range covers the
   total; the summary rows add up to its Total row and to the cover; the
   auxiliary station count matches the list. Errors mean the file needs
   review; warnings are shown but don't block.

Every value is a `Field`: `value` (or `null`), `raw` OCR text, and
`confidence` (the lowest Tesseract word confidence in it, 0–1).

### Reading every voter row

```powershell
pnpm --filter roll-parser exec uv run roll-parser extract C:\path\to\roll.pdf
pnpm --filter roll-parser exec uv run roll-parser extract C:\path\to\roll.pdf --out C:\somewhere\private\result.json
pnpm --filter roll-parser exec uv run roll-parser extract synthetic-rolls/ac40.pdf --truth synthetic-rolls/ac40.json
```

The console shows counts, the quality score, timing and issue codes only, never
voter data. `--out` writes the full result, which **does** contain voter data:
keep it private and delete it when done. `--truth` compares a synthetic roll
with its ground truth and prints the accuracy per field.

How it works (`extract/voters.py`, `extract/roll.py`):

1. **Boxes:** OpenCV finds the 3 × 10 grid (rectangles about a third of the
   page wide and a tenth high) and puts them in reading order.
2. **OCR, three Tesseract calls per page** (instead of the spike's three per
   box): the whole page in sparse-text mode with the box borders removed, and
   the words are assigned to boxes by position; then every box's EPIC,
   stacked into one image and read with a letters-and-digits whitelist; then
   every serial the same way, digits only. The serial and EPIC crops aren't
   fixed positions: the parser finds the first row of character-sized blobs
   at the top of the box (frames and borders removed), takes its rightmost
   group as the EPIC and its leftmost as the serial, and keeps only those
   glyphs. Dictionaries are off, because names and IDs aren't English words.
   `roll-parser id-crops <pdf> --page 3 --out crops.png` shows those crops
   (the image shows EPIC numbers: keep it private).
3. **Fields:** the body is split at its labels (`Name`, `Fathers/Mothers/
Husbands/Others Name`, `House Number`, `Age`, `Gender`); a colon that OCR
   dropped doesn't matter. Wrapped names are joined. `DELETED` / `MODIFIED`
   are read from the photo placeholder area (only the marker is kept).
4. **Normalisation, raw text always kept:** EPIC letters/digits corrected by
   position (`X1Z…` → `XIZ…`); names cleaned (`]` → `I`, a lowercase `l` in a
   capitals-only name → `I`, stray punctuation dropped).
5. **Serial from reading order** (starting at the cover's first serial); the
   serial printed in the box is only a cross-check.
6. **Checks:** per row, missing or low-confidence fields, age outside 18–120,
   printed serial ≠ reading order, EPIC with dropped characters, duplicate EPIC,
   EPIC prefix used only once in the part. Per file, box count vs the serial
   range, extracted male/female/third/total vs the cover, and more than 2%
   serial disagreements. Errors send the file to review.
7. **Quality score:** the average row confidence (a row's confidence is its
   lowest field confidence), halved when a file-level check fails.
8. **Parallel:** voter pages are read in separate processes (default: one per
   CPU). About 28 s for a 23-page part on 4 cores.

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
