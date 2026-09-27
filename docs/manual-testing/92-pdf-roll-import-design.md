# #92: Design for PDF electoral-roll import and hierarchical analytics

**Issue:** https://github.com/yskartheek/BoothConnect/issues/92
**What changed:** documents only; there's no code to run yet.

- `docs/design/voter-roll-pdf-import.md`: the new import and analytics design
- `docs/adr/0002-pdf-roll-extraction.md`: why extraction runs in a separate
  Python worker
- `docs/IMPLEMENTATION_PLAN.md`: geography levels, data model, endpoints,
  admin screens, seed data, tests and open decisions updated to match

## Steps

1. Read the design, section by section, and check it matches what you want:
   - §2: the hierarchy State → PC → AC → Part → Polling Station, and how
     parts and stations are created from the PDF headers
   - §3: the upload flow (dropdowns, which files at which level, matching,
     duplicates, new revisions, review, confirm)
   - §4: what is read from each PDF, and what isn't (photos)
   - §7: the analytics cards, and the parent/child comparison
2. Check §4a (what your sample roll contains, and the OCR spike result) and
   §10 (your answers, recorded as decisions).
3. Look at the plan diff in the PR to see what changes for the existing
   issues.

## Pass criteria

- You agree with the design, or you've left comments on what to change.

## Known issues and notes

- **Only one sample so far.** The spike matched the printed totals exactly on
  it; supplementary rolls, Telugu rolls and parts with auxiliary stations
  still need samples.
- **Real roll PDFs must never be committed.** `.gitignore` now ignores
  `*.pdf`.
- **The existing issues (#19, #21, #26, #36, #44–#49, #71–#74) still describe
  the CSV import.** They'll be updated or replaced once the design is agreed.
