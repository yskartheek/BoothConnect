# roll-parser job and result contract (v1)

- **Status:** Implemented by the worker (#99); to be consumed by the API in #45
- **Code:** `apps/roll-parser/src/roll_parser/worker/contract.py`
- **JSON Schemas:** `apps/roll-parser/contract/*.schema.json`, generated from
  the code (`uv run roll-parser contract --write`). A test fails if the
  committed schemas drift from the code.
- **Design:** [voter-roll-pdf-import.md](voter-roll-pdf-import.md) §4,
  [ADR-0002](../adr/0002-pdf-roll-extraction.md)

## 1. Flow

```text
API                                  Redis (BullMQ)             roll-parser worker
 │ upload PDF to private bucket          │                              │
 │ add job "extract-roll" ──────────────▶│ queue "roll-extraction" ────▶│ download PDF, check SHA-256
 │                                       │                              │ extract header, totals, rows
 │                                       │                              │ put pages/<n>.jpg, result.v1.json
 │◀── job completed, returnvalue = ResultEnvelope ◀─────────────────────│
 │ read result.v1.json, fill import_file / import_row_result            │
```

- **Queue:** `roll-extraction` (BullMQ default prefix `bull`)
- **Job name:** `extract-roll`. Any other name fails the job immediately
  (unrecoverable).
- The worker uses the official BullMQ Python client, so a job added with
  BullMQ for Node (`queue.add(...)`) is processed as usual. This was checked
  with BullMQ 5.81 for Node against the worker.
- All JSON is **camelCase**. Enum values are snake_case strings (e.g.
  `third_gender`, `low_confidence`).

## 2. Job payload (`job.data`)

```json
{
  "version": 1,
  "importFileId": "0192f3a4-…",
  "bucket": "boothconnect-imports",
  "key": "imports/<batchId>/<fileId>.pdf",
  "sha256": "9f86d08…",
  "resultPrefix": "extractions/0192f3a4-…/",
  "options": { "pageImages": true }
}
```

| Field          | Required | Meaning                                                                 |
| -------------- | -------- | ----------------------------------------------------------------------- |
| `version`      | no (1)   | Contract version. Only `1` exists.                                      |
| `importFileId` | yes      | `import_file.id`. Used in logs and in the default result prefix.        |
| `bucket`       | yes      | Private bucket holding the PDF. Results are written to the same bucket. |
| `key`          | yes      | Object key of the PDF.                                                  |
| `sha256`       | no       | Expected SHA-256 (hex). If given and different: `checksum_mismatch`.    |
| `resultPrefix` | no       | Where results go. Default `extractions/<importFileId>/`.                |
| `options`      | no       | `pageImages` (default `true`): render page JPEGs for the review screen. |

**Suggested job options (API side):** `attempts: 3`,
`backoff: { type: 'exponential', delay: 10000 }`, `removeOnComplete` /
`removeOnFail` with an age limit (the API keeps its own record in
`import_file`). Jobs are idempotent: a retry overwrites the same objects.

## 3. Job result (`job.returnvalue`): `ResultEnvelope`

Small, so it can live in Redis. The full result is in the bucket.

**Completed:**

```json
{
  "version": 1,
  "status": "completed",
  "importFileId": "0192f3a4-…",
  "workerVersion": "0.0.0",
  "resultKey": "extractions/0192f3a4-…/result.v1.json",
  "pageImages": [
    {
      "page": 1,
      "kind": "cover",
      "key": "extractions/…/pages/1.jpg",
      "width": 1984,
      "height": 2807
    },
    {
      "page": 3,
      "kind": "voters",
      "key": "extractions/…/pages/3.jpg",
      "width": 1984,
      "height": 2807
    }
  ],
  "summary": {
    "pageCount": 23,
    "rowCount": 571,
    "printedTotals": { "male": 287, "female": 284, "thirdGender": 0, "total": 571 },
    "extractedTotals": { "male": 287, "female": 284, "thirdGender": 0, "total": 571 },
    "qualityScore": 0.8,
    "needsReview": false,
    "issueCounts": { "field.low_confidence": 60, "epic.rare_prefix": 2 }
  },
  "failure": null,
  "timings": { "headerSeconds": 7.2, "voterPagesSeconds": 20.3, "totalSeconds": 27.5 }
}
```

**Failed** (the job still _completes_; retrying wouldn't help):

```json
{
  "version": 1,
  "status": "failed",
  "importFileId": "0192f3a4-…",
  "workerVersion": "0.0.0",
  "resultKey": null,
  "pageImages": [],
  "summary": null,
  "failure": { "code": "pdf_unreadable", "message": "Not a readable PDF (FileDataError)" },
  "timings": null
}
```

| `failure.code`      | When                                                         |
| ------------------- | ------------------------------------------------------------ |
| `invalid_payload`   | `job.data` doesn't match §2 (the message names the fields)   |
| `too_large`         | Bigger than `ROLL_PARSER_MAX_BYTES` (default 100 MB)         |
| `checksum_mismatch` | `sha256` given and different                                 |
| `pdf_unreadable`    | Corrupt, empty or not a PDF                                  |
| `pdf_encrypted`     | Password-protected                                           |
| `not_a_roll`        | No voter pages recognised                                    |
| `timeout`           | Took longer than `ROLL_PARSER_TIMEOUT_SECONDS` (default 600) |

**Transient errors** (storage unreachable, Redis hiccups) aren't caught. The
job _fails_ in BullMQ and is retried per its `attempts`/`backoff`. When
attempts run out, BullMQ's `failedReason` holds the error message; the API
should mark the file `failed` with a generic reason.

## 4. Full result (`result.v1.json`): `ResultDocument`

**Contains voter data.** It's private like the PDF, and must never be logged.

```text
ResultDocument
├── version, importFileId, workerVersion, method ("ocr")
├── source { bucket, key, sha256, sizeBytes }
├── pageImages [ PageImage ]                      (as in the envelope)
└── extraction
    ├── pageCount, method, qualityScore (0–1), timings
    ├── extractedTotals { male, female, thirdGender, total }   (deleted entries excluded)
    ├── issues [ Issue ]                          file-level checks
    ├── header
    │   ├── pages [ "cover" | "maps" | "voters" | "summary" ]  one per page
    │   ├── header { stateCode, stateName, acNumber, acName, acReservation,
    │   │            pcNumber, pcName, pcReservation, partNumber, revisionYear,
    │   │            revisionType, qualifyingDate, publicationDate,
    │   │            rollIdentification, sections[{number, name}], mainTown,
    │   │            postOffice, policeStation, mandal, district, pinCode,
    │   │            pollingStation{number, name, address}, stationType,
    │   │            auxiliaryStationCount, auxiliaryStations[...] }   every leaf is a Field
    │   ├── printedTotals { startSerial, endSerial, counts{male, female, thirdGender, total} }
    │   ├── summary { rows[{rollType, counts}], total }
    │   └── issues [ Issue ]                      cover/summary checks
    └── rows [ ExtractedVoter ]
        ├── page (1-based), boxIndex (0-based, reading order), serial (reading order)
        ├── sectionNumber, printedSerial, epic, name, relationType,
        │   relativeName, houseNumber, age, gender       each a Field
        ├── marker: null | "deleted" | "modified"
        ├── rawText                               OCR text of the box (serial, EPIC, body)
        └── issues [ Issue ]
```

- **Field:** `{ "value": <T or null>, "raw": "<OCR text>", "confidence": 0.0–1.0 }`.
  `value` is `null` when the field is missing or unreadable (there's always an
  issue then). `confidence` is the lowest Tesseract word confidence in the
  value.
- **Issue:** `{ "code", "severity": "error" | "warning", "message", "field", "page" }`.
  Messages never contain voter data. `field` is a camelCase path into this
  document, such as `header.partNumber` or `rows[123].relativeName`, where
  123 is the row's serial.

### Issue codes

| Code                                                                                          | Severity | Where                                         |
| --------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- |
| `field.missing`                                                                               | error    | any field not found / unreadable              |
| `field.low_confidence`                                                                        | warning  | confidence < 0.6                              |
| `epic.invalid`                                                                                | error    | EPIC text found but not 3 letters + 7 digits  |
| `epic.corrected`                                                                              | warning  | characters had to be dropped to find the EPIC |
| `epic.duplicate`, `epic.rare_prefix`                                                          | warning  | per row, across the part                      |
| `age.out_of_range`                                                                            | error    | outside 18–120                                |
| `serial.mismatch`                                                                             | warning  | printed serial ≠ reading order                |
| `serial.many_mismatches`                                                                      | error    | > 2% of rows                                  |
| `rows.count_mismatch`                                                                         | error    | boxes ≠ cover's serial range                  |
| `totals.extracted_mismatch`                                                                   | error    | extracted male/female/third/total ≠ cover     |
| `totals.sum_mismatch`, `totals.serial_range`                                                  | error    | cover/summary arithmetic                      |
| `summary.total_mismatch`, `summary.cover_mismatch`, `summary.no_rows`                         | error    | summary page                                  |
| `header.no_sections`                                                                          | error    | cover                                         |
| `header.section_numbers`, `header.auxiliary_count_mismatch`, `header.station_number_mismatch` | warning  | cover                                         |
| `pages.no_cover`, `pages.no_voter_pages`, `pages.no_summary`                                  | error    | page classification                           |

## 5. Mapping to the import tables (for #45)

| Result                               | Table / column                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `summary.needsReview`                | `import_file.status`: `needs_review` if true, else `ready`                           |
| `status: "failed"`                   | `import_file.status = failed`, `error = failure` (or `rejected` for `not_a_roll`)    |
| `summary.pageCount`                  | `import_file.page_count`                                                             |
| `extraction.header` (values)         | `import_file.detected_header`                                                        |
| `extraction.header.printedTotals`    | `import_file.printed_totals`                                                         |
| `extraction.extractedTotals`         | `import_file.extracted_totals`                                                       |
| `extraction.qualityScore`            | `import_file.quality_score`                                                          |
| `method`                             | `import_file.extraction_method = ocr`                                                |
| each `rows[i]`                       | one `import_row_result`: `page`, `box_index`, `section_no`, `serial_no` (= `serial`) |
| `rows[i].rawText`                    | `import_row_result.raw_text`                                                         |
| `rows[i].<field>.value` (+ `marker`) | `import_row_result.extracted_values`                                                 |
| `rows[i].<field>.confidence`         | `import_row_result.field_confidence`                                                 |
| `rows[i].issues`                     | `import_row_result.messages`; `status` = `warning` if any, else `accepted`           |
| `pageImages[].key`                   | served by `GET /v1/imports/files/:id/pages/:n`                                       |

## 6. Worker settings (environment)

| Variable                                                                                      | Default                  | Meaning                                |
| --------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------- |
| `REDIS_URL`                                                                                   | `redis://localhost:6379` | Same as the API                        |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | as the API               | Object storage                         |
| `ROLL_PARSER_QUEUE`                                                                           | `roll-extraction`        | Queue name                             |
| `ROLL_PARSER_QUEUE_PREFIX`                                                                    | `bull`                   | BullMQ key prefix                      |
| `ROLL_PARSER_CONCURRENCY`                                                                     | `1`                      | Files processed at the same time       |
| `ROLL_PARSER_PAGE_WORKERS`                                                                    | CPU count                | Processes per file (pages in parallel) |
| `ROLL_PARSER_TIMEOUT_SECONDS`                                                                 | `600`                    | Per file                               |
| `ROLL_PARSER_MAX_BYTES`                                                                       | `104857600` (100 MB)     | Larger files fail with `too_large`     |
| `ROLL_PARSER_HEALTH_PORT`                                                                     | `8090`                   | `GET /health`                          |
| `ROLL_PARSER_PAGE_IMAGE_QUALITY`                                                              | `70`                     | JPEG quality of page images            |

`GET /health` returns `200 {"status":"ok","worker":"running","redis":"up",…}`
while the worker runs and Redis answered in the last 60 s; otherwise 503.

## 7. Privacy

- The maps/photos page is classified from its top strip only, and is never
  rendered, stored or extracted. Voter photos aren't extracted (the rolls only
  have a placeholder).
- Logs are JSON lines with ids, counts, codes and timings only. The log
  formatter drops any field that isn't on an allow-list.
- `result.v1.json` and the page images contain voter data, like the PDF: same
  private bucket, same retention rule (to be decided, design §10).

## 8. Versioning

A breaking change bumps `version` (payload and results) and the schema file
names (`*.v2.schema.json`). The worker then accepts both versions until the
API has moved over. Adding optional fields isn't breaking.
