# #97: Cover and summary page parsing

**Issue:** https://github.com/yskartheek/BoothConnect/issues/97
**What changed:**

- New `apps/roll-parser/src/roll_parser/extract/` package:
  - **Page classification:** reads only the top strip of each page. Cover,
    voter pages and summary are recognised by their titles; the maps/photos
    page is skipped and nothing from it is kept.
  - **Cover page:** state code and name, AC number/name/reservation, PC
    number/name/reservation, part number, revision year/type, qualifying and
    publication dates, roll identification, the sections list, main
    town/village, post office, police station, mandal, district, PIN, polling
    station number/name/address, station type, number of auxiliary stations
    (and their list), and the printed totals (serial range; male, female,
    third gender, total).
  - **Summary page:** totals per roll type (mother roll, supplements) and the
    Total row.
  - **Every value keeps its raw OCR text and a confidence** (0–1).
  - **Checks:** a missing field, totals that don't add up, or a summary that
    differs from the cover is an **error** (the file needs review). Low
    confidence (< 0.6) or an auxiliary count that doesn't match the list is a
    **warning**.
- New command `roll-parser header <pdf>` (add `--json` for every field).
- 18 new tests: exact results on the committed roll and on the 23-page
  `ac40` and `ac40-degraded` rolls, plus each check on hand-made text.

## Steps

Needs the roll-parser set up (see #95 or `docs/SETUP.md` section 6).

1. **Your own sample (the main check for this issue).** Use the full path to
   your PDF:
   ```powershell
   pnpm --filter roll-parser exec uv run roll-parser header "C:\path\to\2026-EROLLGEN-S29-40-SIR-DraftRoll-Revision1-ENG.pdf"
   ```
   **Expect** (it takes a few seconds):
   ```text
   pages: 23 (cover, maps, voters, voters, ..., voters, summary)
   state:   S29 Telangana
   AC:      40 PATANCHERU (GENERAL)
   PC:      6 MEDAK (GEN)
   part:    408, sections: <n>, auxiliary stations: 0
   totals:  287 male / 284 female / 0 third gender / 571 total
   issues:  0
   ```
   The output holds no voter data (it never reads the voter boxes), so it's
   safe to paste into a PR comment. **Please post it on the PR**, especially
   if a line differs or there are issues listed: the synthetic rolls use my
   best guess of the label wording, and your sample shows whether it matches.
2. More detail, if something is off:
   ```powershell
   pnpm --filter roll-parser exec uv run roll-parser header "C:\path\to\roll.pdf" --json > header.json
   ```
   **Expect:** every field with `value`, `raw` (the OCR text) and
   `confidence`. A `null` value shows which label wasn't found. The cover has
   no voter data, but check the file before sharing it anyway.
3. A synthetic roll, for comparison:
   ```powershell
   pnpm --filter roll-parser synth ac40
   pnpm --filter roll-parser exec uv run roll-parser header synthetic-rolls/ac40.pdf
   ```
   **Expect:** AC 40 PATANCHERU (GENERAL), PC 6 MEDAK (GEN), part 408,
   totals adding up to 571, and `issues: 0` or a single low-confidence
   warning on a made-up place name.
4. Run the tests:
   ```powershell
   pnpm --filter roll-parser test
   ```
   **Expect:** `41 passed` (about a minute: it generates the two 23-page
   rolls).

## Pass criteria

- Step 1 on your sample shows AC 40 PATANCHERU (GENERAL), PC 6 MEDAK (GEN),
  Part 408 and 287 / 284 / 0 / 571 (the issue's acceptance criterion; it
  can't run in CI because the sample isn't committed).
- Step 4 passes.

## Known issues and notes

- **Label wording and layout now follow your sample's cover** (from the OCR
  lines you posted on the PR): the state in the title line, the
  `Parliamentary Constituency :` label, the revision table without colons,
  `Tehsil/Mandal` and `Subdivision`, the station number and name under their
  label, the auxiliary count split over two lines, and the two-line totals
  header. The synthetic cover copies that layout, and a test feeds the exact
  OCR lines from your sample through the parser. If step 1 still shows
  `field.missing`, the `--json` output shows what OCR read.
- **Section names are read as printed**, OCR noise included (your sample
  gave `Gection Now` for section 2). A low-confidence name is a warning, not
  an error.
- **Addresses that wrap** onto the next line are joined. **Auxiliary
  stations** are read from the list under the count; the synthetic rolls put
  them there, but no real sample with auxiliary stations has been seen yet.
- Page classification uses English titles. Telugu rolls come later.
