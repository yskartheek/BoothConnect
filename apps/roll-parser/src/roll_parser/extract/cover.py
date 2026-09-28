"""Cover page: header fields, sections, polling stations and printed totals."""

import re
from collections.abc import Callable, Sequence

from roll_parser.extract.fields import Field
from roll_parser.extract.models import (
    ExtractedCounts,
    ExtractedHeader,
    ExtractedSection,
    ExtractedStation,
    ExtractedTotals,
)
from roll_parser.extract.text import (
    DASH,
    OPT_SEP,
    SEP,
    LabelledValues,
    as_text,
    first_line_index,
    span_field,
    to_date,
    to_int,
)
from roll_parser.ocr import Line

# Labels on the Telangana S29 English cover page, as regular expressions with
# their separator. The "Details of revision" table has no colons.
REVISION_YEAR = rf"Year of Revision{OPT_SEP}"
REVISION_TYPE = rf"Type of Revision{OPT_SEP}"
QUALIFYING_DATE = rf"Qualifying Date{OPT_SEP}"
PUBLICATION_DATE = rf"Date of Publication{OPT_SEP}"
ROLL_IDENTIFICATION = rf"Roll Identification{OPT_SEP}"
MAIN_TOWN = rf"Main Town or Village{SEP}"
POST_OFFICE = rf"Post Office{SEP}"
POLICE_STATION = rf"Police Station{SEP}"
MANDAL = rf"(?:Tehsil\s*/\s*)?Mandal{SEP}"
SUBDIVISION = rf"Sub\s*division{SEP}"
DISTRICT = rf"District{SEP}"
PIN_CODE = rf"Pin\s*Code{SEP}"
STATION = rf"No\.?\s*and\s*Name of Polling Station{OPT_SEP}"
STATION_ADDRESS = rf"Address of Polling Station{OPT_SEP}"
STATION_TYPE = rf"Type of Polling Station{OPT_SEP}"
STATION_TYPE_HINT = r"\(\s*Male\s*/\s*Female\s*/\s*General\s*\)"
# "Number of Auxiliary Polling Stations in this part", sometimes split in two lines
AUXILIARY_COUNT = rf"(?:Number of\s*)?Auxiliary Polling(?:\s*Stations in this part)?{OPT_SEP}"
AUXILIARY_TAIL = rf"Stations in this part{OPT_SEP}"
AUXILIARY_ADDRESS = rf"Address{SEP}"
PART_NUMBER = rf"Part\s*No\.?{SEP}"
SECTIONS = rf"No\.?\s*and\s*Name of Sections in the part{OPT_SEP}"

LABELS = [
    REVISION_YEAR,
    REVISION_TYPE,
    QUALIFYING_DATE,
    PUBLICATION_DATE,
    ROLL_IDENTIFICATION,
    MAIN_TOWN,
    POST_OFFICE,
    POLICE_STATION,
    MANDAL,
    SUBDIVISION,
    DISTRICT,
    PIN_CODE,
    STATION,
    STATION_ADDRESS,
    STATION_TYPE,
    STATION_TYPE_HINT,
    AUXILIARY_COUNT,
    AUXILIARY_TAIL,
    PART_NUMBER,
    SECTIONS,
]

# "40 - PATANCHERU (GENERAL)": number, name, reservation
CONSTITUENCY = rf"(\w{{1,3}})\s*{DASH}\s*(.+?)\s*\(\s*([A-Z]+)\s*\)"
HEADING = re.compile(r"^\d\s*\.\s+[A-Z]")
NUMBERED = re.compile(rf"^(\w{{1,3}})\s*{DASH}\s*(.+)$")  # "1 - MAKA THANDA"
# An auxiliary station's "408A - NAME" line (spaced dash, unlike "12-3" in an address)
AUXILIARY_LINE = rf"^\s*\d{{1,4}}\s*[A-Z]?\s+{DASH}\s+"
STATION_NUMBER = re.compile(rf"\s*(\d{{1,4}}\s*[A-Z]?)\s*{DASH}\s*(.+)$")  # "408A - SCHOOL ..."


def _digits(raw: str) -> str | None:
    value = to_int(raw)
    return None if value is None else str(value)


def _state_code(raw: str) -> str | None:
    # "S29"; the S is sometimes read as 5
    m = re.fullmatch(r"[S5$](\w{2})", raw.strip())
    number = to_int(m.group(1)) if m else None
    return None if number is None else f"S{number:02d}"


def _groups[T](
    lines: Sequence[Line], patterns: Sequence[str], converters: Sequence[Callable[[str], T | None]]
) -> list[Field[T]]:
    """Fields from the capture groups of the first line matching a pattern.

    Patterns are tried in order (for layouts that print the same thing
    differently).
    """
    for pattern in patterns:
        regex = re.compile(pattern, re.I)
        for line in lines:
            m = regex.search(line.text)
            if m:
                return [
                    span_field(line, m.start(g), m.end(g), convert)
                    for g, convert in enumerate(converters, start=1)
                ]
    return [Field.missing() for _ in converters]


def _joined[T](parts: Sequence[Field[str]], convert: Callable[[str], T | None]) -> Field[T]:
    """One value from pieces on consecutive lines."""
    raw = " ".join(p.raw for p in parts)
    return Field(
        value=convert(raw) if raw else None,
        raw=raw,
        confidence=min((p.confidence for p in parts), default=0.0),
    )


def _numbered_lines(
    lines: Sequence[Line], values: LabelledValues, start: int | None, stop: str
) -> list[tuple[Line, int, int]]:
    """Lines after ``start`` shaped like ``<number> - <name>``, up to ``stop``.

    Returns (line, start, end) spans with any trailing label cut off, because
    OCR often joins a list with the column beside it.
    """
    if start is None:
        return []
    found = []
    for line in lines[start + 1 :]:
        if re.search(stop, line.text, re.I) or HEADING.match(line.text):
            break
        cut = values.any_label.search(line.text)
        end = cut.start() if cut else len(line.text)
        if NUMBERED.match(line.text[:end].strip()):
            found.append((line, 0, end))
    return found


def _sections(lines: Sequence[Line], values: LabelledValues) -> list[ExtractedSection]:
    start = first_line_index(lines, SECTIONS)
    sections = []
    for line, _, end in _numbered_lines(lines, values, start, r"POLLING STATION DETAILS"):
        m = NUMBERED.match(line.text[:end])
        if m:
            sections.append(
                ExtractedSection(
                    number=span_field(line, m.start(1), m.end(1), to_int),
                    name=span_field(line, m.start(2), m.end(2), as_text),
                )
            )
    return sections


def _auxiliary_stations(
    lines: Sequence[Line], values: LabelledValues, after: int
) -> list[ExtractedStation]:
    """``408A - NAME`` lines (each with an ``Address :`` line) after the count."""
    start = first_line_index(lines, AUXILIARY_COUNT)
    if start is None:
        return []
    stations = []
    address_label = re.compile(f"^{AUXILIARY_ADDRESS}", re.I)
    stop = first_line_index(lines, r"NUMBER OF ELECTORS", start) or len(lines)
    for index in range(max(start, after) + 1, stop):
        line = lines[index]
        end, _ = values.before_label(index)
        m = STATION_NUMBER.match(line.text[:end])
        if not m:
            continue
        address: Field[str] = Field.missing()
        if index + 1 < stop and (a := address_label.match(lines[index + 1].text)):
            address = span_field(lines[index + 1], a.end(), len(lines[index + 1].text), as_text)
        stations.append(
            ExtractedStation(
                number=span_field(line, m.start(1), m.end(1), lambda raw: raw.replace(" ", "")),
                name=span_field(line, m.start(2), m.end(2), as_text),
                address=address,
            )
        )
    return stations


def _main_station(values: LabelledValues) -> tuple[ExtractedStation, int]:
    """The polling station, and the index of the last line its name is on.

    ``408 - NAME`` follows the label on the same line or within the next few
    lines (the type-of-station column sits beside it); a long name wraps onto
    the next lines, up to the next label.
    """
    lines = values.lines
    number: Field[str] = Field.missing()
    name: Field[str] = Field.missing()
    last = -1
    label_index = first_line_index(lines, STATION)
    if label_index is not None:
        label = re.search(STATION, lines[label_index].text, re.I)
        start = label.end() if label else 0
        for index in range(label_index, min(label_index + 4, len(lines))):
            line = lines[index]
            end = values.any_label.search(line.text, start)
            m = STATION_NUMBER.match(line.text[: end.start() if end else len(line.text)], start)
            start = 0
            if not m:
                continue
            number = span_field(line, m.start(1), m.end(1), _digits)
            parts = [span_field(line, m.start(2), m.end(2), as_text)]
            last = index
            for following in range(index + 1, min(index + 3, len(lines))):
                cut, _ = values.before_label(following)
                text = lines[following].text[:cut]
                if not text.strip() or HEADING.match(text):
                    break
                parts.append(span_field(lines[following], 0, cut, as_text))
                last = following
            name = _joined(parts, as_text)
            break
    address, _ = values.find(
        STATION_ADDRESS, as_text, continuation=True, below=True, stop=AUXILIARY_LINE
    )
    return ExtractedStation(number=number, name=name, address=address), last


def _totals(lines: Sequence[Line]) -> ExtractedTotals:
    """The row of six numbers under "Starting Serial No. ... Total"."""
    heading = first_line_index(lines, r"NUMBER OF ELECTORS") or 0
    header = first_line_index(lines, r"Starting|Serial\s*No", heading)
    fields: list[Field[int]] = [Field.missing() for _ in range(6)]
    if header is not None:
        for line in lines[header + 1 : header + 5]:
            numbers = list(re.finditer(r"\S+", line.text))
            if len(numbers) == 6 and all(to_int(n.group()) is not None for n in numbers):
                fields = [span_field(line, n.start(), n.end(), to_int) for n in numbers]
                break
    start, end, male, female, third, total = fields
    return ExtractedTotals(
        start_serial=start,
        end_serial=end,
        counts=ExtractedCounts(male=male, female=female, third_gender=third, total=total),
    )


def parse_cover(lines: Sequence[Line]) -> tuple[ExtractedHeader, ExtractedTotals]:
    values = LabelledValues(lines, LABELS)
    state_code, state_name = _groups(
        lines,
        [
            rf"STATE\s*{DASH}\s*\(\s*(\S{{3}})\s*\)\s*(.+)$",
            r"ELECTORAL\s*ROLL[,.]?\s*\d{4}[,.]?\s+([S5$]\w{2})\s+(.+)$",
        ],
        [_state_code, as_text],
    )
    ac = _groups(lines, [rf"Assembly Constituency{SEP}{CONSTITUENCY}"], [to_int, as_text, as_text])
    pc = _groups(
        lines,
        [rf"Parliamentary Constituency[^:;>]*{SEP}{CONSTITUENCY}"],
        [to_int, as_text, as_text],
    )
    part_number, _ = values.find(PART_NUMBER, to_int)
    station, station_end = _main_station(values)

    header = ExtractedHeader(
        state_code=state_code,
        state_name=state_name,
        ac_number=ac[0],
        ac_name=ac[1],
        ac_reservation=ac[2],
        pc_number=pc[0],
        pc_name=pc[1],
        pc_reservation=pc[2],
        part_number=part_number,
        revision_year=values.find(REVISION_YEAR, to_int)[0],
        revision_type=values.find(REVISION_TYPE, as_text, continuation=True)[0],
        qualifying_date=values.find(QUALIFYING_DATE, to_date)[0],
        publication_date=values.find(PUBLICATION_DATE, to_date)[0],
        roll_identification=values.find(ROLL_IDENTIFICATION, as_text, below=True)[0],
        sections=_sections(lines, values),
        main_town=values.find(MAIN_TOWN, as_text)[0],
        post_office=values.find(POST_OFFICE, as_text)[0],
        police_station=values.find(POLICE_STATION, as_text)[0],
        mandal=values.find(MANDAL, as_text)[0],
        subdivision=values.find(SUBDIVISION, as_text)[0],
        district=values.find(DISTRICT, as_text)[0],
        pin_code=values.find(PIN_CODE, _digits)[0],
        polling_station=station,
        station_type=values.find(STATION_TYPE, as_text)[0],
        auxiliary_station_count=values.find(AUXILIARY_COUNT, to_int)[0],
        auxiliary_stations=_auxiliary_stations(lines, values, after=station_end),
    )
    return header, _totals(lines)
