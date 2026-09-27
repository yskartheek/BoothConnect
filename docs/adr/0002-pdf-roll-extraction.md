# ADR-0002: PDF electoral-roll extraction in a Python worker

- **Status:** Accepted (owner, 2026-09-27)
- **Date:** 2026-09-27
- **Deciders:** project owner
- **Related:** #92, [design](../design/voter-roll-pdf-import.md), ADR-0001

## Context

Voter data now arrives as PDF electoral rolls, one per Part, instead of CSV.
Some of these PDFs have a usable text layer. Many don't: the pages are
scanned, or the Indic fonts don't map to Unicode correctly, so copied text is
garbage. Every page is a grid of voter boxes, often bilingual (English plus a
regional script). A single Assembly Constituency is 250–300 PDFs.

We need reliable extraction with a confidence score for every field, OCR for
Indian scripts, and layout detection (finding the boxes), and it must run as a
background job, apart from the API.

## Decision

Add a **roll-parser worker** written in **Python**, at `apps/roll-parser`:

- Consumes extraction jobs from the existing Redis queue, reads PDFs from
  object storage, and writes results back through the API's internal endpoints
  (or directly to the import tables, decided at implementation time).
- **PyMuPDF** reads the text layer and renders pages; **OpenCV** detects the
  box grid; **Tesseract 5** does OCR with the needed language packs (English
  plus the state's script), with PaddleOCR as a fallback we can evaluate if
  Tesseract accuracy on the samples is poor.
- Runs as its own container, scaled independently. It never serves user
  requests.
- Tested with a fixture set of real and synthetic roll pages, comparing
  expected against extracted values with an accuracy threshold in CI.

## Alternatives considered

| Option                                              | Why not                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node only (pdf.js + tesseract.js)                   | Keeps one server language, but tesseract.js is slower and has weaker Indic support, and there's no OpenCV-level layout tooling.                                          |
| Cloud OCR (Google Document AI, AWS Textract, Azure) | Very good accuracy, but it sends voter personal data to a third party. Needs a legal review and a data-residency decision; can be added later behind the same interface. |
| Manual conversion to CSV outside the app            | No new code, but slow, error-prone, and has no audit trail or confidence scores.                                                                                         |
| Commercial roll-conversion services                 | Unclear provenance and data handling; the same legal concern.                                                                                                            |

## Consequences

- A third language in the repo (TypeScript, Dart, now Python), with its own
  lint/test job in CI and its own Docker image.
- Accuracy depends on the actual PDFs. A first spike on the owner's Telangana
  sample (image-only, so OCR only) found 571/571 voter boxes and matched the
  printed gender totals exactly; details in the design, §4a.
- The interface (job in → rows with confidence out) allows switching the
  engine later, e.g. to a cloud OCR, without changing the API or the admin
  UI.
