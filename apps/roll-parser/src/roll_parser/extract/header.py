"""Cover and summary extraction for a whole roll PDF, with consistency checks."""

import pymupdf

from roll_parser.extract.cover import parse_cover
from roll_parser.extract.fields import Field, Issue, Severity
from roll_parser.extract.images import remove_rules, render
from roll_parser.extract.models import (
    OPTIONAL_HEADER_FIELDS,
    ExtractedCounts,
    ExtractedHeader,
    ExtractedSummary,
    ExtractedTotals,
    HeaderExtraction,
)
from roll_parser.extract.pages import classify
from roll_parser.extract.summary import parse_summary
from roll_parser.model import PageKind
from roll_parser.ocr import Line, read_lines

# Below this, a value is flagged for a person to check
LOW_CONFIDENCE = 0.6


def _error(code: str, message: str, **kwargs: object) -> Issue:
    return Issue.model_validate(
        {"code": code, "severity": Severity.ERROR, "message": message, **kwargs}
    )


def _warning(code: str, message: str, **kwargs: object) -> Issue:
    return Issue.model_validate(
        {"code": code, "severity": Severity.WARNING, "message": message, **kwargs}
    )


def _check_field[T](field: Field[T], path: str, page: int) -> list[Issue]:
    if field.value is None:
        return [_error("field.missing", f"{path} not found or unreadable", field=path, page=page)]
    if field.confidence < LOW_CONFIDENCE:
        return [
            _warning(
                "field.low_confidence",
                f"{path} read with low confidence ({field.confidence:.2f})",
                field=path,
                page=page,
            )
        ]
    return []


def _check_header(header: ExtractedHeader, page: int) -> list[Issue]:
    issues: list[Issue] = []
    for name, field in header.scalar_fields().items():
        if name in OPTIONAL_HEADER_FIELDS and field.value is None:
            continue
        issues += _check_field(field, f"header.{name}", page)
    for name in ("number", "name", "address"):
        issues += _check_field(
            getattr(header.polling_station, name), f"header.polling_station.{name}", page
        )

    if not header.sections:
        issues.append(_error("header.no_sections", "No sections found on the cover", page=page))
    for i, section in enumerate(header.sections):
        issues += _check_field(section.number, f"header.sections[{i}].number", page)
        issues += _check_field(section.name, f"header.sections[{i}].name", page)
    numbers = [s.number.value for s in header.sections]
    if header.sections and numbers != list(range(1, len(numbers) + 1)):
        issues.append(
            _warning("header.section_numbers", "Section numbers aren't 1, 2, 3, ...", page=page)
        )

    for i, station in enumerate(header.auxiliary_stations):
        for name in ("number", "name", "address"):
            path = f"header.auxiliary_stations[{i}].{name}"
            issues += _check_field(getattr(station, name), path, page)
    count = header.auxiliary_station_count.value
    if count is not None and count != len(header.auxiliary_stations):
        issues.append(
            _warning(
                "header.auxiliary_count_mismatch",
                f"Cover says {count} auxiliary stations but lists {len(header.auxiliary_stations)}",
                page=page,
            )
        )

    station_number = header.polling_station.number.value
    part = header.part_number.value
    if station_number is not None and part is not None and station_number != str(part):
        issues.append(
            _warning(
                "header.station_number_mismatch",
                f"Polling station number {station_number} differs from part number {part}",
                page=page,
            )
        )
    return issues


def _counts_tuple(counts: ExtractedCounts) -> tuple[int | None, ...]:
    return (counts.male.value, counts.female.value, counts.third_gender.value, counts.total.value)


def _check_counts(counts: ExtractedCounts, path: str, page: int) -> list[Issue]:
    issues: list[Issue] = []
    for name in ("male", "female", "third_gender", "total"):
        issues += _check_field(getattr(counts, name), f"{path}.{name}", page)
    male, female, third, total = _counts_tuple(counts)
    if (
        male is not None
        and female is not None
        and third is not None
        and total is not None
        and male + female + third != total
    ):
        issues.append(
            _error(
                "totals.sum_mismatch",
                f"{path}: {male} male + {female} female + {third} third gender != {total} total",
                page=page,
            )
        )
    return issues


def _check_totals(totals: ExtractedTotals, page: int) -> list[Issue]:
    issues = _check_field(totals.start_serial, "printed_totals.start_serial", page)
    issues += _check_field(totals.end_serial, "printed_totals.end_serial", page)
    issues += _check_counts(totals.counts, "printed_totals.counts", page)
    start, end, total = (
        totals.start_serial.value,
        totals.end_serial.value,
        totals.counts.total.value,
    )
    if start is not None and end is not None and total is not None and end - start + 1 < total:
        issues.append(
            _error(
                "totals.serial_range",
                f"Serial range {start}-{end} is shorter than the total ({total})",
                page=page,
            )
        )
    return issues


def _check_summary(
    summary: ExtractedSummary, totals: ExtractedTotals | None, page: int
) -> list[Issue]:
    if not summary.rows:
        return [_error("summary.no_rows", "No roll-type rows found on the summary page", page=page)]
    issues: list[Issue] = []
    for i, row in enumerate(summary.rows):
        issues += _check_field(row.roll_type, f"summary.rows[{i}].roll_type", page)
        issues += _check_counts(row.counts, f"summary.rows[{i}].counts", page)
    columns = zip(*(_counts_tuple(r.counts) for r in summary.rows), strict=True)
    sums = tuple(sum(v or 0 for v in column) for column in columns)
    if summary.total is not None and _counts_tuple(summary.total) != sums:
        issues.append(
            _error(
                "summary.total_mismatch", "Summary rows don't add up to its Total row", page=page
            )
        )
    if totals is not None and _counts_tuple(totals.counts) != sums:
        issues.append(
            _error(
                "summary.cover_mismatch",
                f"Summary totals {sums} differ from the cover's {_counts_tuple(totals.counts)}",
                page=page,
            )
        )
    return issues


def _lines(page: pymupdf.Page) -> list[Line]:
    return read_lines(remove_rules(render(page)))


def extract_header(doc: pymupdf.Document) -> HeaderExtraction:
    kinds = classify(doc)
    issues: list[Issue] = []
    header: ExtractedHeader | None = None
    totals: ExtractedTotals | None = None
    summary: ExtractedSummary | None = None

    if PageKind.COVER in kinds:
        index = kinds.index(PageKind.COVER)
        header, totals = parse_cover(_lines(doc[index]))
        issues += _check_header(header, index + 1)
        issues += _check_totals(totals, index + 1)
    else:
        issues.append(_error("pages.no_cover", "No cover page found"))

    if PageKind.VOTERS not in kinds:
        issues.append(_error("pages.no_voter_pages", "No voter pages found"))

    if PageKind.SUMMARY in kinds:
        index = len(kinds) - 1 - kinds[::-1].index(PageKind.SUMMARY)
        summary = parse_summary(_lines(doc[index]))
        issues += _check_summary(summary, totals, index + 1)
    else:
        issues.append(_error("pages.no_summary", "No summary page found"))

    return HeaderExtraction(
        pages=kinds, header=header, printed_totals=totals, summary=summary, issues=issues
    )
