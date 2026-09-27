# #96: Synthetic roll PDF generator and test fixtures

**Issue:** https://github.com/yskartheek/BoothConnect/issues/96
**What changed:**

- `apps/roll-parser/src/roll_parser/synthetic/`: a generator that draws a fake
  electoral roll in the Telangana S29 English layout and saves it as an
  **image-only PDF** (one grayscale JPEG per page, 1984 × 2807 px, like the
  sample's 1983 × 2806), plus a **ground-truth JSON** file.
  - Page 1: cover (AC/PC/part, revision details, sections, town/post
    office/police station/mandal/district/PIN, polling station, auxiliary
    stations, printed totals).
  - Page 2: a placeholder for the maps and building photos (grey boxes only).
  - Voter pages: page header with AC, part and section; 3 × 10 boxes with the
    serial box, EPIC, name (long names wrap), relation
    (`Fathers`/`Mothers`/`Husbands`/`Others Name`), house number, age, gender
    and the "Photo Available" placeholder.
  - Last page: summary of electors by roll type.
- Fake data only, from a fixed seed: common first names plus made-up family
  and place names, made-up EPIC numbers with varied prefixes (including
  letters Tesseract confuses with digits, and one-off prefixes), all relation
  types, deleted and modified entries, third gender, several sections, an
  auxiliary station.
- Options to damage the images (JPEG quality, blur, slight rotation, noise)
  for robustness tests.
- `src/roll_parser/model.py`: the shape of what a roll says (header, totals,
  voter entries). The parser in #97–#98 is checked against it.
- Three presets: `small` (5 pages, committed in `tests/fixtures/`), `ac40`
  (23 pages, 571 electors, like your sample) and `ac40-degraded`. The last
  two are generated when the tests run.
- New command `pnpm --filter roll-parser synth`.
- 18 new tests, including a round trip: every value in the ground truth is
  found in its box on the page, nothing extra is drawn, the output PDF has no
  text layer, and Tesseract can read a rendered box.

## Steps

Needs the roll-parser set up (see #95 or `docs/SETUP.md` section 6).

1. Generate the rolls:
   ```powershell
   pnpm --filter roll-parser synth
   ```
   **Expect:** three lines, one per preset, for example
   `synthetic-rolls/small.pdf  (ground truth: small.json)`. It takes about
   20 seconds. The files are in `apps/roll-parser/synthetic-rolls/`, which git
   ignores.
2. **Compare with your real sample (the main check for this issue).** Open
   `apps/roll-parser/synthetic-rolls/ac40.pdf` and your
   `2026-EROLLGEN-S29-40-...pdf` side by side.
   **Expect:** the same overall layout: cover page sections, a maps page, 3 ×
   10 voter boxes with the serial box top left and the EPIC top right, the
   photo placeholder on the right of each box, and a summary page. 23 pages.
   Fonts and exact spacing differ. Please note anything that is laid out
   differently, especially:
   - wording of the labels (e.g. `Fathers Name`, `House Number`,
     `Section No and Name`)
   - where the section header sits, and whether a new section starts on a new
     page
   - how deleted or modified entries are marked (the generator writes
     `DELETED` / `MODIFIED` in the photo area; see page 3 of `small.pdf`)
   - the summary page's rows
3. Open `apps/roll-parser/synthetic-rolls/small.json` in an editor.
   **Expect:** `header` (with `ac_name`, `sections`, `auxiliary_stations`...),
   `printed_totals`, `summary`, `pages` and `voters`. Pick any voter and find
   it in `small.pdf` at the given `page` and `box_index` (0 is the top-left
   box, counting across then down): every field matches.
4. Open `ac40-degraded.pdf`.
   **Expect:** the same roll, visibly softer, slightly tilted and grainy.
5. Run the tests:
   ```powershell
   pnpm --filter roll-parser test
   ```
   **Expect:** `22 passed`.

## Pass criteria

- Step 2: the synthetic roll looks like the real one in structure (the
  owner's call; please comment on the PR with any differences).
- Step 3: the ground truth matches the page.
- Step 5 passes.

## Known issues and notes

- **Layout assumptions** that need a real sample to confirm: sections always
  start on a new page, and the deleted/modified marker position. Your sample
  has neither several sections on one page nor deleted entries, so these are
  best guesses. They're easy to change once we see a real example.
- **No real personal data:** every name, place, EPIC number and address is
  made up. The AC/PC names (Patancheru, Medak) are public geography.
- The committed `tests/fixtures/small.pdf` is 1.7 MB. The bigger rolls are
  only generated during the tests, never committed.
- If the generator changes, `test_committed_fixture_matches_the_generator`
  fails until the fixture is regenerated (command in
  `apps/roll-parser/README.md`).
