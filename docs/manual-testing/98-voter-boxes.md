# #98: Voter-box extraction with confidence and normalisation

**Issue:** https://github.com/yskartheek/BoothConnect/issues/98
**What changed:**

- `roll-parser` now reads **every voter box**: serial, EPIC, name (wrapped
  lines joined), relation type, relative's name, house number, age, gender,
  and the DELETED / MODIFIED marker. Each value keeps its raw OCR text and a
  confidence (0–1).
- Productionised from the spike, with these changes:
  - **Serial numbers come from reading order**; the serial printed in the box
    is only a cross-check (disagreements are flagged).
  - **EPIC letter/digit correction by position** (`X1Z…` → `XIZ…`), and a
    flag on EPIC prefixes that appear only once in the part.
  - **Name clean-up** (`]` → `I`, lowercase `l` → `I`, stray punctuation),
    always keeping the raw text.
  - **Faster:** three Tesseract calls per page instead of three per box, and
    pages run in parallel. About 28 s for a 23-page part on 4 cores.
- **Checks:** per row (missing or low-confidence fields, age outside 18–120,
  serial disagreement, EPIC problems, duplicates) and per file (box count and
  male/female/third/total against the cover). A **quality score** per file.
- New command `roll-parser extract <pdf>`. The console only shows counts and
  issue codes (no voter data); `--out` writes the full result.

## Results on the synthetic rolls

| Roll              | Boxes   | Serial | EPIC  | Name  | Relative | House | Age  | Gender | Wrong values | Unflagged |
| ----------------- | ------- | ------ | ----- | ----- | -------- | ----- | ---- | ------ | ------------ | --------- |
| `small` (5 pages) | 42/42   | 100%   | 100%  | 100%  | 100%     | 100%  | 100% | 100%   | 0            | 0         |
| `ac40` (23 pages) | 571/571 | 100%   | 100%  | 100%  | 100%     | 100%  | 100% | 100%   | 0            | 0         |
| `ac40-degraded`   | 571/571 | 100%   | 99.8% | 99.8% | 100%     | 100%  | 100% | 100%   | 2            | 0         |

Required: ≥ 99% for gender/age/serial/EPIC, ≥ 98% for names, and every wrong
value flagged. CI checks all of these.

## Steps

Needs the roll-parser set up (see #95 or `docs/SETUP.md` section 6).

1. **Your own sample (the main check for this issue).** Use the full path:
   ```powershell
   pnpm --filter roll-parser exec uv run roll-parser extract "C:\path\to\2026-EROLLGEN-S29-40-SIR-DraftRoll-Revision1-ENG.pdf"
   ```
   **Expect** (under a minute):
   ```text
   pages:     23, voter rows: 571
   extracted: 287 male / 284 female / 0 third gender / 571 total (deleted entries excluded)
   printed:   287 male / 284 female / 0 third gender / 571 total
   quality:   0.8x
   time:      ...
   file issues: none
   row issues:  {...} on N rows
   ```
   This output has no voter data, so you can paste it on the PR. Please do.
   The acceptance check is **571 rows, 287 M / 284 F**.
2. Optional, to look at individual rows. This file **contains voter data**:
   save it somewhere private, don't commit or share it, and delete it
   afterwards.
   ```powershell
   pnpm --filter roll-parser exec uv run roll-parser extract "C:\path\to\roll.pdf" --out "$env:TEMP\roll-result.json"
   ```
   Open it and search for `"issues": [{` to see flagged rows. Each field has
   `value`, `raw` and `confidence`. Compare a few flagged rows with the PDF.
   Then `Remove-Item "$env:TEMP\roll-result.json"`.
3. A synthetic roll with the accuracy report:
   ```powershell
   pnpm --filter roll-parser synth ac40-degraded
   pnpm --filter roll-parser exec uv run roll-parser extract synthetic-rolls/ac40-degraded.pdf --truth synthetic-rolls/ac40-degraded.json
   ```
   **Expect:** the per-field table above, with `of which unflagged: 0`.
4. Tests:
   ```powershell
   pnpm --filter roll-parser test
   ```
   **Expect:** `65 passed`, in about 3 minutes (it extracts two 23-page rolls).

## Pass criteria

- Step 1 on your sample: 571 rows, 287 male / 284 female, matching the cover.
- Steps 3 and 4 pass.

## Known issues and notes

- **Warnings on correct values:** about 1 row in 10 gets a low-confidence
  warning, mostly on ages that were read correctly (Tesseract gives short
  numbers low confidence). These are warnings, not errors; they don't send the
  file to review on their own. We can tune this once there are real reviews.
- **Your sample's labels and markers** may be worded a little differently
  from the synthetic rolls. If step 1 shows many `field.missing` issues, post
  the issue counts and I'll adjust the labels.
- **Deleted/modified markers:** the parser looks for `DELETED` / `MODIFIED`
  where the photo placeholder is. Your sample has no deleted entries, so this
  is still unconfirmed on a real roll.
- Voter photos aren't extracted (the sample has only the placeholder), and
  nothing from the photo area is kept except the marker.
