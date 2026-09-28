"""A whole roll PDF: header, printed totals and every voter row, with checks.

Voter pages are read in parallel worker processes (one Tesseract call per
page). Serial numbers come from reading order, section by section, starting at
the printed starting serial; the serial printed in each box is only a
cross-check (the spike found it unreliable).
"""

import multiprocessing
import os
import time
from collections import Counter
from collections.abc import Iterable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path
from typing import ClassVar

import pymupdf
from pydantic import BaseModel, ConfigDict

from roll_parser.extract.fields import Field, Issue, Severity
from roll_parser.extract.header import LOW_CONFIDENCE, extract_header
from roll_parser.extract.images import remove_rules, render
from roll_parser.extract.models import HeaderExtraction, MissingValueError, _v
from roll_parser.extract.text import to_int
from roll_parser.extract.voters import (
    SERIAL_LEFT,
    SERIAL_RIGHT,
    BoxText,
    epic_chars,
    find_boxes,
    id_crops,
    normalise_epic,
    page_section,
    parse_body,
    parse_marker,
    remove_box_lines,
    split_box,
    top_strip,
)
from roll_parser.model import ElectorCounts, EntryMarker, Gender, PageKind, RelationType, VoterEntry
from roll_parser.ocr import Line, read_strips, read_words_scaled

# Voter pages are enlarged before OCR: the box text is small (about 7.5 pt)
OCR_SCALE = float(os.environ.get("ROLL_PARSER_OCR_SCALE", "1"))

# More than this share of serial disagreements sends the file to review
SERIAL_MISMATCH_LIMIT = 0.02


class ExtractedVoter(BaseModel):
    """One voter box. Carries personal data: never log it."""

    model_config = ConfigDict(frozen=True)

    page: int  # 1-based
    box_index: int  # 0-based, reading order on the page
    section_number: Field[int]
    serial: int  # from reading order
    printed_serial: Field[int]  # as OCR'd from the box; a cross-check only
    epic: Field[str]
    name: Field[str]
    relation_type: Field[RelationType]
    relative_name: Field[str]
    house_number: Field[str]
    age: Field[int]
    gender: Field[Gender]
    marker: EntryMarker | None
    raw_text: str
    issues: list[Issue]

    FIELDS: ClassVar[tuple[str, ...]] = (
        "epic",
        "name",
        "relation_type",
        "relative_name",
        "house_number",
        "age",
        "gender",
    )

    @property
    def confidence(self) -> float:
        """Lowest confidence among the row's fields."""
        return min(float(getattr(self, name).confidence) for name in self.FIELDS)

    def values(self) -> VoterEntry:
        return VoterEntry(
            serial=self.serial,
            section_number=_v(self.section_number, "section_number"),
            page=self.page,
            box_index=self.box_index,
            epic=_v(self.epic, "epic"),
            name=_v(self.name, "name"),
            relation_type=_v(self.relation_type, "relation_type"),
            relative_name=_v(self.relative_name, "relative_name"),
            house_number=_v(self.house_number, "house_number"),
            age=_v(self.age, "age"),
            gender=_v(self.gender, "gender"),
            marker=self.marker,
        )


class Timings(BaseModel):
    header_seconds: float
    voter_pages_seconds: float
    total_seconds: float


class RollExtraction(BaseModel):
    """Everything extracted from one roll PDF."""

    page_count: int
    method: str = "ocr"
    header: HeaderExtraction
    rows: list[ExtractedVoter]
    extracted_totals: ElectorCounts  # counted from the rows, deleted entries excluded
    quality_score: float  # 0-1
    issues: list[Issue]  # file-level (header issues are in header.issues)
    timings: Timings

    @property
    def needs_review(self) -> bool:
        return (
            self.header.needs_review
            or any(i.severity == Severity.ERROR for i in self.issues)
            or any(i.severity == Severity.ERROR for row in self.rows for i in row.issues)
        )


# --- reading one page (runs in a worker process) --------------------------------


@dataclass(frozen=True)
class PageRead:
    page: int  # 1-based
    section: Field[int]
    boxes: list[BoxText]


def _limit_threads() -> None:
    # Each worker runs one Tesseract at a time; stop it spawning more threads
    os.environ["OMP_THREAD_LIMIT"] = "1"


EPIC_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def _best_epic(candidates: list[Line]) -> Line:
    """The first reading that is a clean 10-character EPIC, else the first
    that normalises to one, else the first non-empty one."""
    readable = [c for c in candidates if c.text]
    for line in readable:
        if len(epic_chars(line.text)) == 10 and normalise_epic(line.text):
            return line
    for line in readable:
        if normalise_epic(line.text):
            return line
    return readable[0] if readable else candidates[0]


def read_voter_page(pdf: Path, index: int) -> PageRead:
    """Three Tesseract calls per page: the whole page in sparse-text mode, then
    every box's EPIC strip, then every serial box, each stacked into one image
    (whitelisted characters, no dictionary), which reads IDs far more reliably
    than the page-wide pass."""
    with pymupdf.open(pdf) as doc:
        image = render(doc[index])
    boxes = find_boxes(image)
    clean = remove_rules(image)
    words = read_words_scaled(clean, OCR_SCALE, dictionary=False)
    grid_top = min((b.y for b in boxes), default=int(image.shape[0] * 0.08))
    number, confidence = page_section([w for w in words if w.cy < grid_top])
    section: Field[int] = Field(
        value=number, raw="" if number is None else str(number), confidence=confidence
    )

    texts = [split_box(b, words) for b in boxes]
    # The ID crops are cut from the box's top row. The EPIC is also read from
    # the fixed strip, and whichever reading is a valid EPIC is kept (glyph
    # crop first), so an unusual layout can't make it worse than the strip.
    ids = [id_crops(image, b) for b in boxes]
    strips = [top_strip(clean, b, SERIAL_RIGHT, 1.0) for b in boxes]
    glyph_epics = read_strips(
        [e if e is not None else s for (_, e), s in zip(ids, strips, strict=True)],
        whitelist=EPIC_CHARS,
    )
    strip_epics = read_strips(strips, whitelist=EPIC_CHARS)
    serials = read_strips(
        [
            s if s is not None else remove_box_lines(top_strip(image, b, SERIAL_LEFT, SERIAL_RIGHT))
            for (s, _), b in zip(ids, boxes, strict=True)
        ],
        whitelist="0123456789",
    )
    texts = [
        replace(
            t,
            serial=serial if serial.text else t.serial,
            epic=_best_epic([glyph, strip, t.epic]),
        )
        for t, serial, glyph, strip in zip(texts, serials, glyph_epics, strip_epics, strict=True)
    ]
    return PageRead(page=index + 1, section=section, boxes=texts)


# --- rows and checks -------------------------------------------------------------


def _issue(severity: Severity, code: str, message: str, **kwargs: object) -> Issue:
    return Issue.model_validate({"code": code, "severity": severity, "message": message, **kwargs})


def build_row(page: PageRead, box_index: int, box: BoxText, serial: int) -> ExtractedVoter:
    body = parse_body(box.body)
    epic_raw = box.epic.text
    epic: Field[str] = Field(
        value=normalise_epic(epic_raw),
        raw=epic_raw,
        confidence=box.epic.confidence(0, len(epic_raw)),
    )
    printed_raw = box.serial.text
    printed: Field[int] = Field(
        value=to_int(printed_raw.replace(" ", "")),
        raw=printed_raw,
        confidence=box.serial.confidence(0, len(printed_raw)),
    )
    row = ExtractedVoter(
        page=page.page,
        box_index=box_index,
        section_number=page.section,
        serial=serial,
        printed_serial=printed,
        epic=epic,
        name=body.name,
        relation_type=body.relation_type,
        relative_name=body.relative_name,
        house_number=body.house_number,
        age=body.age,
        gender=body.gender,
        marker=parse_marker(box.photo),
        raw_text=box.raw_text,
        issues=[],
    )
    return row.model_copy(update={"issues": _row_issues(row)})


def _row_issues(row: ExtractedVoter) -> list[Issue]:
    where = {"page": row.page}
    issues = []
    for name in ExtractedVoter.FIELDS:
        field: Field[object] = getattr(row, name)
        path = f"rows[{row.serial}].{name}"
        if field.value is None:
            code = "epic.invalid" if name == "epic" and field.raw else "field.missing"
            issues.append(
                _issue(Severity.ERROR, code, f"{name} not found or unreadable", field=path, **where)
            )
        elif field.confidence < LOW_CONFIDENCE:
            issues.append(
                _issue(
                    Severity.WARNING,
                    "field.low_confidence",
                    f"{name} read with low confidence ({field.confidence:.2f})",
                    field=path,
                    **where,
                )
            )
    if row.epic.value is not None and len(epic_chars(row.epic.raw)) != 10:
        issues.append(
            _issue(
                Severity.WARNING,
                "epic.corrected",
                "EPIC had extra or missing characters; check it",
                field=f"rows[{row.serial}].epic",
                **where,
            )
        )
    if row.age.value is not None and not 18 <= row.age.value <= 120:
        issues.append(
            _issue(
                Severity.ERROR,
                "age.out_of_range",
                "age outside 18-120",
                field=f"rows[{row.serial}].age",
                **where,
            )
        )
    if row.printed_serial.value != row.serial:
        issues.append(
            _issue(
                Severity.WARNING,
                "serial.mismatch",
                f"printed serial {row.printed_serial.value} differs from reading order "
                f"{row.serial}",
                field=f"rows[{row.serial}].serial",
                **where,
            )
        )
    if row.section_number.value is None:
        issues.append(
            _issue(
                Severity.ERROR,
                "field.missing",
                "section number not found in the page header",
                field=f"rows[{row.serial}].section_number",
                **where,
            )
        )
    return issues


def _with(row: ExtractedVoter, issue: Issue) -> ExtractedVoter:
    return row.model_copy(update={"issues": [*row.issues, issue]})


def _part_checks(rows: list[ExtractedVoter]) -> list[ExtractedVoter]:
    """Checks that need the whole part: duplicate EPICs and rare prefixes."""
    epics = Counter(r.epic.value for r in rows if r.epic.value)
    prefixes = Counter(e[:3] for e in epics.elements())
    checked = []
    for row in rows:
        epic = row.epic.value
        if epic and epics[epic] > 1:
            row = _with(
                row,
                _issue(
                    Severity.WARNING,
                    "epic.duplicate",
                    "EPIC appears more than once in the part",
                    field=f"rows[{row.serial}].epic",
                    page=row.page,
                ),
            )
        if epic and len(rows) >= 20 and prefixes[epic[:3]] == 1:
            row = _with(
                row,
                _issue(
                    Severity.WARNING,
                    "epic.rare_prefix",
                    "EPIC prefix used only once in the part (possible misread)",
                    field=f"rows[{row.serial}].epic",
                    page=row.page,
                ),
            )
        checked.append(row)
    return checked


def _counts(rows: Iterable[ExtractedVoter]) -> ElectorCounts:
    active = [r for r in rows if r.marker is not EntryMarker.DELETED]
    genders = Counter(r.gender.value for r in active)
    return ElectorCounts(
        male=genders[Gender.MALE],
        female=genders[Gender.FEMALE],
        third_gender=genders[Gender.THIRD_GENDER],
        total=len(active),
    )


def _file_checks(
    header: HeaderExtraction, rows: list[ExtractedVoter], counts: ElectorCounts
) -> list[Issue]:
    issues: list[Issue] = []
    totals = header.printed_totals
    if totals is not None:
        try:
            printed = totals.values()
        except MissingValueError:
            printed = None
        if printed is not None:
            expected = printed.end_serial - printed.start_serial + 1
            if len(rows) != expected:
                issues.append(
                    _issue(
                        Severity.ERROR,
                        "rows.count_mismatch",
                        f"{len(rows)} voter boxes found; the cover's serial range has {expected}",
                    )
                )
            if counts != printed.counts:
                issues.append(
                    _issue(
                        Severity.ERROR,
                        "totals.extracted_mismatch",
                        "Extracted totals (male/female/third/total) "
                        f"{counts.male}/{counts.female}/{counts.third_gender}/{counts.total} "
                        f"differ from the cover's {printed.counts.male}/{printed.counts.female}/"
                        f"{printed.counts.third_gender}/{printed.counts.total}",
                    )
                )
    mismatches = sum(1 for r in rows for i in r.issues if i.code == "serial.mismatch")
    if rows and mismatches / len(rows) > SERIAL_MISMATCH_LIMIT:
        issues.append(
            _issue(
                Severity.ERROR,
                "serial.many_mismatches",
                f"{mismatches} printed serials differ from reading order",
            )
        )
    return issues


def quality_score(
    rows: list[ExtractedVoter], file_issues: list[Issue], header: HeaderExtraction
) -> float:
    """Average row confidence, halved when a file-level check fails."""
    if not rows:
        return 0.0
    score = sum(r.confidence for r in rows) / len(rows)
    if header.needs_review or any(i.severity == Severity.ERROR for i in file_issues):
        score /= 2
    return round(score, 3)


def extract_roll(pdf: Path, *, workers: int | None = None) -> RollExtraction:
    started = time.perf_counter()
    with pymupdf.open(pdf) as doc:
        page_count = doc.page_count
        header = extract_header(doc)
    header_done = time.perf_counter()

    voter_pages = [i for i, kind in enumerate(header.pages) if kind is PageKind.VOTERS]
    workers = workers or min(os.cpu_count() or 1, len(voter_pages)) or 1
    if workers == 1:
        reads = [read_voter_page(pdf, i) for i in voter_pages]
    else:
        # "spawn", not fork: forking a process that already runs OpenCV/PyMuPDF
        # threads can deadlock. It's also what Windows does anyway.
        context = multiprocessing.get_context("spawn")
        with ProcessPoolExecutor(workers, mp_context=context, initializer=_limit_threads) as pool:
            reads = list(pool.map(read_voter_page, [pdf] * len(voter_pages), voter_pages))

    start_serial = 1
    if header.printed_totals is not None and header.printed_totals.start_serial.value is not None:
        start_serial = header.printed_totals.start_serial.value
    rows: list[ExtractedVoter] = []
    for page in reads:
        for box_index, box in enumerate(page.boxes):
            rows.append(build_row(page, box_index, box, start_serial + len(rows)))
    rows = _part_checks(rows)
    counts = _counts(rows)
    issues = _file_checks(header, rows, counts)
    finished = time.perf_counter()

    return RollExtraction(
        page_count=page_count,
        header=header,
        rows=rows,
        extracted_totals=counts,
        quality_score=quality_score(rows, issues, header),
        issues=issues,
        timings=Timings(
            header_seconds=round(header_done - started, 2),
            voter_pages_seconds=round(finished - header_done, 2),
            total_seconds=round(finished - started, 2),
        ),
    )
