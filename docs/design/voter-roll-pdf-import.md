# Design: PDF electoral-roll import and hierarchical analytics

- **Status:** Draft for review (#92)
- **Replaces:** the CSV-only voter-list import in spec §7.2 and plan §2–§7; extends the dashboards in spec §8
- **Decision record:** [ADR-0002](../adr/0002-pdf-roll-extraction.md)

## 1. Summary

Administrators import the official electoral roll as **PDF files**, one PDF per
**Part**, as published. They choose where the files belong in the geography
using cascading dropdowns, at any level from State down to Part, and upload
one or many PDFs. A background worker reads each PDF (text layer first, OCR
when the PDF is scanned), extracts the header and every voter entry, and checks
the result against the totals printed in the roll. The admin reviews and
corrects the extraction, then confirms. Only confirmed data becomes live.

Analytics are computed for **every node** in the hierarchy (station, part, AC,
PC, state). Each node shows its own figures, how it compares to its siblings,
and the breakdown of its children.

## 2. Geography hierarchy

```text
State                                   e.g. Andhra Pradesh (S01)
└── Parliamentary Constituency (PC)     Lok Sabha seat, e.g. 04 Visakhapatnam
    └── Assembly Constituency (AC)      MLA seat, e.g. 021 Visakhapatnam East
        └── Part / Polling Area         e.g. Part 117 – Ward 12, MVP Colony
            └── Polling Station (Booth) e.g. 117 – ZPH School, Room 2
```

- Stored in the existing `geography_node` + closure table (plan §3), with
  `type` limited to `state`, `pc`, `ac`, `part`, `polling_station`. Each type
  may only have the parent type shown above.
- `code` is the official number (AC 021, Part 117), and is unique among
  siblings. The display name and the language-specific names live in
  `metadata`.
- **Part vs polling station.** The roll is published per Part, and a Part
  normally has **one** polling station. Some Parts have auxiliary stations
  (e.g. 117A) that split the Part by section or serial range. So:
  - Every Part gets one main polling station, created automatically from the
    PDF header.
  - Auxiliary stations can be added under the Part. Voters are assigned to a
    station by section or serial range; unassigned voters stay with the main
    station.
  - Volunteers are assigned at polling-station level, as today.
- **Where the hierarchy comes from:**
  - State, PC and AC are **master data**. They're loaded once from a small
    CSV (code, name, parent code) or created in the admin UI. They rarely
    change.
  - Parts and polling stations are **created from the PDF headers** during
    import, and shown to the admin for confirmation before they're saved.

## 3. Upload flow (admin web)

1. **Choose the level.** Cascading dropdowns: State → PC → AC → Part. The
   admin stops at any level. Each dropdown lists only the children of the
   previous choice (`GET /v1/geographies?parentId=`), and each has a search
   box, because an AC has about 250–300 parts.
2. **Add files.** Drag and drop, or pick one or more PDFs, or a ZIP of PDFs.
   - At **Part** level: exactly one PDF.
   - At **AC, PC or State** level: many PDFs (one per part), or ZIPs.
   - Files upload straight to object storage with presigned URLs, in chunks,
     and resume after a dropped connection. A whole AC is roughly 250–300 PDFs
     and 300–600 MB.
3. **Automatic matching.** For each PDF the system reads the header (State,
   AC number and name, Part number and name, polling-station name and
   address, PC where printed, revision date) and places the file under the
   chosen node:
   - Header outside the chosen node (e.g. a PDF from a different AC):
     **rejected**, with the reason.
   - Same file as one already imported (same SHA-256 checksum): flagged as a
     **duplicate** and skipped.
   - Part already has data from an older revision: imported as a **new source
     version**; the old one is kept for audit and comparison.
4. **Batch progress.** One row per file: uploaded → extracting → needs review
   / ready → confirmed, or failed / rejected, with page and voter counts and a
   quality score.
5. **Review** (per file, or all ready files at once):
   - Header and the part/station that will be created or updated
   - Totals check: voters extracted vs totals printed in the roll (men, women,
     third gender, overall)
   - Rows with low OCR confidence or failed validation are highlighted. The
     admin can correct a field (with the page image beside it) or reject the
     row.
   - Deleted/"under adjudication" entries are shown but not imported as
     active voters.
6. **Confirm.** Confirmed rows become live; analytics refresh for that part
   and every ancestor. Everything is recorded: batch, file, checksum,
   extraction method, corrections (who and when) and confirmer.

## 4. Extraction pipeline

Runs asynchronously in a dedicated **roll-parser worker** that takes jobs from
the Redis queue (see ADR-0002 for why this is a separate Python service).

1. **Store:** the PDF goes to the private import bucket. It's never public,
   and its checksum is recorded.
2. **Detect:** if the PDF has a usable text layer, read the text with
   positions. Otherwise (scanned pages, or Indic fonts whose text doesn't
   map to Unicode correctly, which is common) rasterise each page at 300 DPI
   and OCR it.
3. **Layout:** roll pages use a fixed grid of voter boxes (usually 3 columns ×
   10 rows). Box borders are detected on the page image, so each box is read
   separately; this is far more reliable than reading the page as free text.
4. **Parse:**
   - **Header / cover page:** state, AC, PC, part number and name, polling
     station(s), sections list, revision type and date.
   - **Each voter box:** serial number, EPIC (voter ID) number, name, relative's
     name and relation type (father/mother/husband/other), house number, age,
     gender, and a deleted/modified marker where printed.
   - **Summary page:** printed totals by gender, and additions/deletions for
     the revision.
   - Bilingual rolls: keep the English and the regional-script values in
     `source_data`; the languages to OCR are set per state.
5. **Validate** each row: EPIC format, age 18–120, gender value, serial
   numbers continuous within a section, no duplicate EPIC within the part (or
   across parts in the same revision).
6. **Score:** every field carries an OCR/parse confidence. The file gets a
   quality score from the confidence values and the totals check. Files below
   a threshold, or whose totals don't match, go to **needs review**; they
   never go live automatically.
7. **Output:** normalised rows into `import_row_result` (with page, box
   position and confidence), then the same preview → correct → confirm flow as
   before.

**Not extracted:** voter **photographs**. They are cropped out and never
stored. The spec rules out biometric processing, and we don't need them.

## 5. Data model changes (plan §3)

```text
geography_node        + type in (state, pc, ac, part, polling_station), code, name,
                        metadata {names_by_lang, address, ...}; unique (parent_id, type, code)
geography_import      id, program_id, file_ref, uploaded_by, status, row_counts   -- State/PC/AC master CSV

import_batch          id, program_id, target_node_id, uploaded_by, status, file_count,
                      created_at, confirmed_at, confirmed_by
import_file           id, batch_id, file_ref, checksum (unique per program), page_count,
                      detected_header jsonb, part_node_id, source_version_id,
                      extraction_method (text|ocr), quality_score,
                      printed_totals jsonb, extracted_totals jsonb,
                      status (uploaded|extracting|needs_review|ready|confirmed|rejected|failed),
                      error jsonb
import_row_result     + import_file_id, page, box_index, field_confidence jsonb,
                        corrected_values jsonb, corrected_by, corrected_at
source_version        + part_node_id, revision_type, published_on
voter                 + part_id, polling_station_id (replaces booth_id), section_no,
                        serial_no, epic_no (= source_voter_id)
node_stats            node_id, source_version_scope, metrics jsonb, computed_at
                      -- one row per node, rebuilt after each confirm
```

`import_job` (plan §3) becomes `import_batch` + `import_file`, because one
upload can now hold hundreds of files.

## 6. API changes (plan §4, all under `/v1`)

```text
GET    /geographies?parentId&type&q            dropdown data (scoped)
POST   /geographies                            admin: create State/PC/AC node
POST   /geographies/imports                    admin: State/PC/AC master CSV

POST   /imports/batches                        { targetNodeId } → batch
POST   /imports/batches/:id/files              → presigned (multipart) upload URLs
POST   /imports/batches/:id/files/:fileId/complete   → queue extraction
GET    /imports/batches/:id                    per-file status, counts, quality
GET    /imports/files/:id/preview              header, totals check, paged rows
GET    /imports/files/:id/pages/:n             page image for side-by-side correction
PATCH  /imports/files/:id/rows/:rowId          correct fields or reject a row (audited)
POST   /imports/files/:id/confirm              single file
POST   /imports/batches/:id/confirm            every file in "ready" state
GET    /imports/files/:id/rejections.csv       formula-injection-safe (unchanged rule)

GET    /analytics/nodes/:id/summary            this node's metrics (cohort ≥ 10)
GET    /analytics/nodes/:id/children?metric    breakdown by child node, sortable
GET    /analytics/nodes/:id/revisions          change between source versions
```

All of these go through `GeoScopeGuard`: an admin scoped to one AC can only
see and upload within that AC.

## 7. Analytics

Every node shows the same set of cards, computed for that node's subtree:

| Group        | Metrics                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| Electors     | Total voters; men / women / third gender; gender ratio (women per 1,000 men)                 |
| Age          | Bands 18–19 (first-time), 20–29, 30–39, 40–49, 50–59, 60–79, 80+; median age                 |
| Households   | Households, average voters per household, large households (> 10 voters, often a data issue) |
| Revisions    | Additions and deletions since the previous revision; net change                              |
| Data quality | Extraction quality, rows corrected, rows rejected, duplicate EPICs, missing age or gender    |
| Field work   | Households visited / assigned, voters verified, pending corrections (once visits exist)      |

- **Parent analysis:** each node page also shows (a) the **children table**,
  with one row per child (e.g. all parts of an AC) and every metric as a
  sortable column, with the parent total and average; and (b) **how this node
  compares** to its siblings and its parent (e.g. "gender ratio 962 vs AC
  average 981").
- **Navigation:** drill down from State to station, and breadcrumbs back up.
- **How it's computed:** `node_stats` is rebuilt for the affected part and
  all its ancestors after each confirm. Parent values are sums (and weighted
  averages) of child values via the closure table, so the State page stays
  fast even with tens of millions of voters.
- **Privacy rules (from the spec, enforced by the API):**
  - Any figure for a group smaller than **10** people is suppressed ("< 10"),
    and so is any figure that would let it be worked out by subtraction.
  - Only attributes printed in the roll (age, gender, household,
    revision changes) and field-work status are analysed.
  - **No inference of religion, caste, community or political leaning** —
    not from names, relatives' names, addresses or anything else. The
    restricted fields stay disabled (spec §7.3, plan §3).
  - The rest of spec §8.2 applies: the threshold also covers filters and
    intersections, small categories are combined, every card shows its
    definition and "updated at" time, and unknown/missing is shown separately
    from zero.
  - Aggregates only. Record-level lists remain limited to the people assigned
    to that booth.

## 8. Scale assumptions

| Level         | Parts       | Voters (approx.) |
| ------------- | ----------- | ---------------- |
| Part          | 1           | 800–1,500        |
| AC            | 250–300     | 2–3 lakh         |
| PC            | 1,500–2,000 | 15–20 lakh       |
| State (large) | 50,000+     | 5+ crore         |

Extraction runs in parallel workers, roughly 10–40 seconds per part with OCR.
A whole AC therefore takes minutes, and a whole state is an overnight batch. A
state-level upload is supported, but AC-level batches are the expected normal
case.

## 9. Legal and policy notes

- Electoral rolls are published for electoral purposes. Before production,
  confirm the permitted uses and retention for how BoothConnect will use them
  (spec §22, open decisions).
- Rolls contain personal data: PDFs and extracted data stay in private
  storage, access is scoped and audited, and PDFs are deleted after a
  retention period once confirmed (period to be decided).
- Nothing is ever written back to the official roll (spec §3, non-goals).

## 10. Open questions (need answers before implementation)

1. **Sample PDFs.** Which state(s)? Please share 2–3 real part PDFs (or
   redacted ones). The answer decides whether we can rely on the text layer
   or must OCR, and which languages the OCR needs.
2. **Master data.** Will you provide the State → PC → AC list as a CSV, or
   should admins enter it in the UI?
3. **Auxiliary polling stations.** Are they used in your area? If not, we
   keep strictly one station per part and skip the assignment rules.
4. **Photos.** Confirm we never extract voter photographs.
5. **Retention.** How long should the uploaded PDFs be kept after confirm?
