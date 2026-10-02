# Architecture decision records

Short documents that record an important technical decision, why it was made
and what else was considered. They're never rewritten after acceptance: if a
decision changes, write a new ADR that supersedes the old one and update the
old one's status.

To add one, copy [`0000-template.md`](0000-template.md) to
`NNNN-short-title.md` with the next free number, and add it to the table.

| ADR                                             | Title                                                       | Status   |
| ----------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-technology-stack.md)                | Technology stack                                            | Accepted |
| [0002](0002-pdf-roll-extraction.md)             | PDF roll extraction (Python worker)                         | Accepted |
| [0003](0003-direct-volunteer-edits.md)          | Direct volunteer edits, no approval                         | Accepted |
| [0004](0004-geography-scope-and-404.md)         | Geography scope on every request, 404 outside it            | Accepted |
| [0005](0005-official-data-and-field-values.md)  | Official data vs field values, and provenance               | Accepted |
| [0006](0006-offline-sync-protocol.md)           | Offline sync protocol                                       | Accepted |
| [0007](0007-hash-chained-audit-log.md)          | Hash-chained, append-only audit log                         | Accepted |
| [0008](0008-restricted-fields.md)               | Restricted fields: off by default, consent and legal basis  | Accepted |
| [0009](0009-voter-accounts-and-verification.md) | Voters sign in with their EPIC and the mobile on record     | Accepted |
| [0010](0010-erasure-of-personal-data.md)        | Erasing a person's data on request, in an append-only store | Proposed |
