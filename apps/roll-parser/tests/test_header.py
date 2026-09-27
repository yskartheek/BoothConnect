"""Cover and summary extraction (#97)."""

from collections.abc import Callable
from pathlib import Path

import pymupdf
import pytest

from roll_parser.cli import main
from roll_parser.extract.cover import parse_cover
from roll_parser.extract.fields import Issue
from roll_parser.extract.header import _check_header, _check_summary, _check_totals, extract_header
from roll_parser.extract.pages import classify_title
from roll_parser.extract.summary import parse_summary
from roll_parser.model import PageKind, RollTruth
from roll_parser.ocr import Line, Word

from .conftest import FIXTURES, SyntheticRoll


def fake_lines(text: str, confidence: float = 0.95) -> list[Line]:
    """OCR lines as Tesseract would return them, for testing the parsers."""
    lines = []
    for n, row in enumerate(t for t in text.strip().splitlines() if t.strip()):
        words, offset = [], 0
        for token in row.split():
            words.append(Word(token, confidence, offset, offset + len(token)))
            offset += len(token) + 1
        lines.append(Line(" ".join(row.split()), tuple(words), n * 40, n * 40 + 30, 0))
    return lines


COVER = """
ELECTORAL ROLL, 2026
STATE - (S29) TELANGANA
No., Name and Reservation Status of Assembly Constituency : 40 - PATANCHERU (GENERAL) Part No. : 408
No., Name and Reservation Status of Parliamentary Constituency(ies) in which the Assembly Constituency is located : 6 - MEDAK (GEN)
1. DETAILS OF REVISION
Year of Revision : 2026 Type of Revision : Special Intensive Revision
Qualifying Date : 01-01-2026 Date of Publication : 10-02-2026
Roll Identification : Draft Roll
2. DETAILS OF PART & POLLING AREA
No. and Name of Sections in the part : Main Town or Village : TOWNA
1 - FIRST NAGAR Post Office : TOWNA
2 - SECOND PET Police Station : STATIONA
Mandal : MANDALA
District : SANGAREDDY
Pin Code : 502319
3. POLLING STATION DETAILS
No. and Name of Polling Station : 408 - SCHOOL A
Address of Polling Station : SCHOOL A, ROOM 1,
TOWNA
Type of Polling Station : General
Number of Auxiliary Polling Stations in this Part : 0
4. NUMBER OF ELECTORS
Starting Serial No. Ending Serial No. Male Female Third Gender Total
1 571 287 284 0 571
"""

SUMMARY = """
SUMMARY OF ELECTORS
Part No. : 408
Roll Type Male Female Third Gender Total
Mother Roll 287 284 0 571
Total 287 284 0 571
"""


def codes(issues: list[Issue]) -> list[str]:
    return [issue.code for issue in issues]


# --- the owner's sample, as text: the values the issue asks for ------------


def test_cover_text_gives_every_field() -> None:
    header, totals = parse_cover(fake_lines(COVER))
    h = header.values()
    assert (h.ac_number, h.ac_name, h.ac_reservation) == (40, "PATANCHERU", "GENERAL")
    assert (h.pc_number, h.pc_name, h.pc_reservation) == (6, "MEDAK", "GEN")
    assert h.part_number == 408
    assert (h.state_code, h.state_name) == ("S29", "TELANGANA")
    assert [s.name for s in h.sections] == ["FIRST NAGAR", "SECOND PET"]
    assert (h.main_town, h.post_office, h.police_station) == ("TOWNA", "TOWNA", "STATIONA")
    assert h.polling_station.address == "SCHOOL A, ROOM 1, TOWNA"  # wrapped line joined
    assert h.qualifying_date.isoformat() == "2026-01-01"
    t = totals.values()
    assert (t.start_serial, t.end_serial) == (1, 571)
    assert (t.counts.male, t.counts.female, t.counts.third_gender, t.counts.total) == (
        287,
        284,
        0,
        571,
    )
    assert _check_header(header, 1) == []
    assert _check_totals(totals, 1) == []


def test_raw_text_and_confidence_are_kept() -> None:
    header, _ = parse_cover(fake_lines(COVER.replace("S29", "529"), confidence=0.8))
    assert header.state_code.value == "S29"  # 5 read for S, corrected
    assert header.state_code.raw == "529"
    assert header.ac_name.confidence == pytest.approx(0.8)


def test_summary_matching_the_cover_passes() -> None:
    _, totals = parse_cover(fake_lines(COVER))
    summary = parse_summary(fake_lines(SUMMARY))
    assert [r.values().roll_type for r in summary.rows] == ["Mother Roll"]
    assert _check_summary(summary, totals, 23) == []


# --- problems are flagged -----------------------------------------------------


def test_missing_field_is_an_error() -> None:
    header, _ = parse_cover(fake_lines(COVER.replace("Part No. : 408", "")))
    issues = _check_header(header, 1)
    assert [(i.code, i.severity, i.field) for i in issues] == [
        ("field.missing", "error", "header.part_number")
    ]


def test_low_confidence_is_a_warning() -> None:
    header, _ = parse_cover(fake_lines(COVER, confidence=0.4))
    issues = _check_header(header, 1)
    assert issues and {i.code for i in issues} == {"field.low_confidence"}
    assert {i.severity for i in issues} == {"warning"}


def test_totals_that_dont_add_up_are_an_error() -> None:
    _, totals = parse_cover(fake_lines(COVER.replace("1 571 287 284 0 571", "1 571 287 284 0 570")))
    assert codes(_check_totals(totals, 1)) == ["totals.sum_mismatch"]


def test_summary_that_differs_from_the_cover_is_an_error() -> None:
    _, totals = parse_cover(fake_lines(COVER))
    summary = parse_summary(fake_lines(SUMMARY.replace("Mother Roll 287", "Mother Roll 286")))
    assert codes(_check_summary(summary, totals, 23)) == [
        "totals.sum_mismatch",
        "summary.total_mismatch",
        "summary.cover_mismatch",
    ]


def test_summary_adds_up_supplements() -> None:
    _, totals = parse_cover(fake_lines(COVER))
    summary = parse_summary(
        fake_lines(
            """
            Roll Type Male Female Third Gender Total
            Mother Roll 280 280 0 560
            Supplement 1 7 4 0 11
            Total 287 284 0 571
            """
        )
    )
    assert len(summary.rows) == 2
    assert _check_summary(summary, totals, 23) == []


def test_auxiliary_count_must_match_the_list() -> None:
    cover = COVER.replace("in this Part : 0", "in this Part : 1")
    header, _ = parse_cover(fake_lines(cover))
    assert codes(_check_header(header, 1)) == ["header.auxiliary_count_mismatch"]


@pytest.mark.parametrize(
    ("title", "kind"),
    [
        ("ELECTORAL ROLL, 2026 STATE - (S29) TELANGANA", PageKind.COVER),
        (
            "Assembly Constituency No and Name : 40-X Part No. : 408 Section No and Name : 1-Y",
            PageKind.VOTERS,
        ),
        ("SUMMARY OF ELECTORS", PageKind.SUMMARY),
        ("NAZRI NAKSHA GOOGLE MAP", None),
    ],
)
def test_page_titles(title: str, kind: PageKind | None) -> None:
    assert classify_title(title) == kind


# --- synthetic PDFs, end to end ------------------------------------------------


def assert_exact(pdf: Path, truth: RollTruth) -> None:
    result = extract_header(pymupdf.open(pdf))
    assert result.pages == truth.pages
    assert not result.needs_review, result.issues
    assert result.header is not None and result.header.values() == truth.header
    assert result.printed_totals is not None
    assert result.printed_totals.values() == truth.printed_totals
    assert result.summary is not None
    assert [row.values() for row in result.summary.rows] == truth.summary


def test_committed_fixture_is_read_exactly() -> None:
    truth = RollTruth.model_validate_json((FIXTURES / "small.json").read_text("utf-8"))
    assert_exact(FIXTURES / "small.pdf", truth)


@pytest.mark.parametrize("preset", ["ac40", "ac40-degraded"])
def test_generated_rolls_are_read_exactly(
    preset: str, synthetic_roll: Callable[[str], SyntheticRoll]
) -> None:
    assert_exact(*synthetic_roll(preset))


def test_header_command(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["header", str(FIXTURES / "small.pdf")]) == 0
    out = capsys.readouterr().out
    assert "AC:      40 PATANCHERU (GENERAL)" in out
    assert "totals:  19 male / 20 female / 1 third gender / 40 total" in out
    assert "issues:  0" in out


def test_header_command_reports_a_missing_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["header", str(tmp_path / "nope.pdf")]) == 1
    assert "No such file" in capsys.readouterr().err
