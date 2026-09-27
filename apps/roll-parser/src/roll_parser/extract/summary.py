"""Summary page: elector totals per roll type, and the grand total."""

import re
from collections.abc import Sequence

from roll_parser.extract.models import ExtractedCounts, ExtractedSummary, ExtractedSummaryRow
from roll_parser.extract.text import as_text, first_line_index, span_field, to_int
from roll_parser.ocr import Line

# "Mother Roll 19 20 1 40": a label, then male, female, third gender, total
ROW = re.compile(r"^(?P<label>[A-Za-z][A-Za-z0-9 .()\-]*?)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$")


def _counts(line: Line, m: re.Match[str]) -> ExtractedCounts | None:
    male, female, third, total = (
        span_field(line, m.start(g), m.end(g), to_int) for g in range(2, 6)
    )
    if None in (male.value, female.value, third.value, total.value):
        return None
    return ExtractedCounts(male=male, female=female, third_gender=third, total=total)


def parse_summary(lines: Sequence[Line]) -> ExtractedSummary:
    header = first_line_index(lines, r"Roll\s*Type")
    rows: list[ExtractedSummaryRow] = []
    total: ExtractedCounts | None = None
    for line in lines[(header + 1) if header is not None else 0 :]:
        m = ROW.match(line.text)
        counts = _counts(line, m) if m else None
        if not m or counts is None:
            continue
        if re.fullmatch(r"(Grand\s*)?Total", m.group("label").strip(), re.I):
            total = counts
        else:
            label = span_field(line, m.start("label"), m.end("label"), as_text)
            rows.append(ExtractedSummaryRow(roll_type=label, counts=counts))
    return ExtractedSummary(rows=rows, total=total)
