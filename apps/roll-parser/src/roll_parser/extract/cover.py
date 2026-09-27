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
    SEP,
    LabelledValues,
    as_text,
    first_line_index,
    span_field,
    to_date,
    to_int,
)
from roll_parser.ocr import Line

# Labels on the Telangana S29 English cover page, as regular expressions
REVISION_YEAR = r"Year of Revision"
REVISION_TYPE = r"Type of Revision"
QUALIFYING_DATE = r"Qualifying Date"
PUBLICATION_DATE = r"Date of Publication"
ROLL_IDENTIFICATION = r"Roll Identification"
MAIN_TOWN = r"Main Town or Village"
POST_OFFICE = r"Post Office"
POLICE_STATION = r"Police Station"
MANDAL = r"Mandal"
DISTRICT = r"District"
PIN_CODE = r"Pin\s*Code"
STATION = r"No\.?\s*and\s*Name of Polling Station"
STATION_ADDRESS = r"Address of Polling Station"
STATION_TYPE = r"Type of Polling Station"
AUXILIARY_COUNT = r"Number of Auxiliary Polling Stations in this Part"
AUXILIARY_ADDRESS = r"Address"
PART_NUMBER = r"Part\s*No\.?"
SECTIONS = r"No\.?\s*and\s*Name of Sections in the part"

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
    DISTRICT,
    PIN_CODE,
    STATION,
    STATION_ADDRESS,
    STATION_TYPE,
    AUXILIARY_COUNT,
    PART_NUMBER,
    SECTIONS,
]

# "40 - PATANCHERU (GENERAL)": number, name, reservation
CONSTITUENCY = rf"(\w{{1,3}})\s*{DASH}\s*(.+?)\s*\(\s*([A-Z]+)\s*\)"
HEADING = re.compile(r"^\d\s*\.\s+[A-Z]")
NUMBERED = re.compile(rf"^(\w{{1,3}})\s*{DASH}\s*(.+)$")  # "1 - MAKA THANDA"
STATION_NUMBER = re.compile(rf"^(\d{{1,4}}\s*[A-Z]?)\s*{DASH}\s*(.+)$")  # "408A - SCHOOL ..."


def _digits(raw: str) -> str | None:
    value = to_int(raw)
    return None if value is None else str(value)


def _state_code(raw: str) -> str | None:
    # "S29"; the S is sometimes read as 5
    m = re.fullmatch(r"[S5$](\w{2})", raw.strip())
    number = to_int(m.group(1)) if m else None
    return None if number is None else f"S{number:02d}"


def _groups[T](
    lines: Sequence[Line], pattern: str, converters: Sequence[Callable[[str], T | None]]
) -> list[Field[T]]:
    """Fields from the capture groups of the first line matching ``pattern``."""
    regex = re.compile(pattern, re.I)
    for line in lines:
        m = regex.search(line.text)
        if m:
            return [
                span_field(line, m.start(g), m.end(g), convert)
                for g, convert in enumerate(converters, start=1)
            ]
    return [Field.missing() for _ in converters]


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


def _auxiliary_stations(lines: Sequence[Line], values: LabelledValues) -> list[ExtractedStation]:
    start = first_line_index(lines, AUXILIARY_COUNT)
    if start is None:
        return []
    stations = []
    address_label = re.compile(f"^{AUXILIARY_ADDRESS}{SEP}", re.I)
    stop = first_line_index(lines, r"NUMBER OF ELECTORS", start) or len(lines)
    for index in range(start + 1, stop):
        line = lines[index]
        m = STATION_NUMBER.match(line.text)
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


def _main_station(values: LabelledValues) -> ExtractedStation:
    station, index = values.find(STATION, as_text)
    number: Field[str] = Field.missing()
    name: Field[str] = Field.missing()
    if index is not None and station.raw:
        line = values.lines[index]
        offset = line.text.find(station.raw)
        m = STATION_NUMBER.match(station.raw)
        if m and offset >= 0:
            number = span_field(line, offset + m.start(1), offset + m.end(1), _digits)
            name = span_field(line, offset + m.start(2), offset + m.end(2), as_text)
    address, _ = values.find(STATION_ADDRESS, as_text, continuation=True)
    return ExtractedStation(number=number, name=name, address=address)


def _totals(lines: Sequence[Line]) -> ExtractedTotals:
    """The row of six numbers under "Starting Serial No. ... Total"."""
    header = first_line_index(lines, r"Starting\s*Serial")
    fields: list[Field[int]] = [Field.missing() for _ in range(6)]
    if header is not None:
        for line in lines[header + 1 : header + 4]:
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
        lines, rf"STATE\s*{DASH}\s*\(\s*(\S{{3}})\s*\)\s*(.+)$", [_state_code, as_text]
    )
    ac = _groups(lines, rf"Assembly Constituency{SEP}{CONSTITUENCY}", [to_int, as_text, as_text])
    pc = _groups(lines, rf"is located{SEP}{CONSTITUENCY}", [to_int, as_text, as_text])
    part_number, _ = values.find(PART_NUMBER, to_int)

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
        revision_type=values.find(REVISION_TYPE, as_text)[0],
        qualifying_date=values.find(QUALIFYING_DATE, to_date)[0],
        publication_date=values.find(PUBLICATION_DATE, to_date)[0],
        roll_identification=values.find(ROLL_IDENTIFICATION, as_text)[0],
        sections=_sections(lines, values),
        main_town=values.find(MAIN_TOWN, as_text)[0],
        post_office=values.find(POST_OFFICE, as_text)[0],
        police_station=values.find(POLICE_STATION, as_text)[0],
        mandal=values.find(MANDAL, as_text)[0],
        district=values.find(DISTRICT, as_text)[0],
        pin_code=values.find(PIN_CODE, _digits)[0],
        polling_station=_main_station(values),
        station_type=values.find(STATION_TYPE, as_text)[0],
        auxiliary_station_count=values.find(AUXILIARY_COUNT, to_int)[0],
        auxiliary_stations=_auxiliary_stations(lines, values),
    )
    return header, _totals(lines)
