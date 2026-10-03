"""Voter-box extraction (#98)."""

import itertools
from collections.abc import Callable
from pathlib import Path

import pymupdf
import pytest

from roll_parser.cli import main
from roll_parser.extract.images import render
from roll_parser.extract.roll import RollExtraction, _file_checks, extract_roll
from roll_parser.extract.voters import (
    clean_name,
    find_boxes,
    normalise_epic,
    parse_body,
    parse_gender,
)
from roll_parser.model import ElectorCounts, Gender, RelationType, RollTruth
from roll_parser.synthetic.accuracy import compare

from .conftest import FIXTURES
from .test_header import fake_lines

# --- normalisation ------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "epic"),
    [
        ("DMO9000004", "DMO9000004"),
        ("D1M9000004", "DIM9000004"),  # 1 read for I, as in the spike
        ("0MD9000007", "OMD9000007"),
        ("DMO90B200O", "DMO9082000"),  # letters in the digit part
        ("  dmo 908 2000 ", "DMO9082000"),
        ("DMO90820", None),  # too short
    ],
)
def test_epic_letters_and_digits_are_corrected_by_position(raw: str, epic: str | None) -> None:
    assert normalise_epic(raw) == epic


@pytest.mark.parametrize(
    ("raw", "name"),
    [
        ("KUMAR]", "KUMARI"),  # ] read for I, as in the spike
        ("SAl SURESH", "SAI SURESH"),  # lowercase l in a capitals-only name
        ("RAV1 KUMAR.", "RAVI KUMAR"),
        ("  LAKSHMI   DEMOREDDY ,", "LAKSHMI DEMOREDDY"),
        ("|||", "III"),
        ("..", None),
    ],
)
def test_names_are_cleaned(raw: str, name: str | None) -> None:
    assert clean_name(raw) == name


def test_gender_values() -> None:
    assert parse_gender("Male") is Gender.MALE
    assert parse_gender("Fernale") is Gender.FEMALE
    assert parse_gender("Third Gender") is Gender.THIRD_GENDER
    assert parse_gender("?") is None


def test_body_fields_with_wrapped_names_and_lost_colons() -> None:
    (line,) = fake_lines(
        "Name SITA RAMA DEMO KUMARI DEMOREDDY Husbands Name : RAVI DEMOREDDY "
        "House Number : 9-9/Z Age 61 Gender : Female"
    )
    body = parse_body(line)
    assert body.name.value == "SITA RAMA DEMO KUMARI DEMOREDDY"
    assert body.name.raw == "SITA RAMA DEMO KUMARI DEMOREDDY"
    assert body.relation_type.value is RelationType.HUSBAND
    assert body.relative_name.value == "RAVI DEMOREDDY"
    assert body.house_number.value == "9-9/Z"
    assert body.age.value == 61
    assert body.gender.value is Gender.FEMALE
    assert 0 < body.name.confidence <= 1


def test_a_missing_label_leaves_the_field_empty() -> None:
    (line,) = fake_lines("Name : RAVI Fathers Name : GOPAL House Number : 1-2 Gender : Male")
    body = parse_body(line)
    assert body.age.value is None
    assert body.house_number.value == "1-2"  # still ends at the next label found


# --- boxes ---------------------------------------------------------------------


@pytest.mark.parametrize(("page", "count"), [(2, 24), (3, 18)])
def test_boxes_are_found_in_reading_order(page: int, count: int) -> None:
    image = render(pymupdf.open(FIXTURES / "small.pdf")[page])
    boxes = find_boxes(image)
    assert len(boxes) == count
    rows = [boxes[i : i + 3] for i in range(0, count, 3)]
    for row in rows:
        assert row[0].x < row[1].x < row[2].x
        assert abs(row[0].y - row[2].y) < row[0].h / 4
    assert all(a[0].y < b[0].y for a, b in itertools.pairwise(rows))


# --- checks ------------------------------------------------------------------------


def test_totals_that_differ_from_the_cover_are_an_error(
    extracted_roll: Callable[[str], tuple[RollExtraction, RollTruth]],
) -> None:
    result, _ = extracted_roll("small")
    wrong = ElectorCounts(male=18, female=20, third_gender=1, total=39)
    codes = [i.code for i in _file_checks(result.header, result.rows[:-1], wrong)]
    assert codes == ["rows.count_mismatch", "totals.extracted_mismatch"]


# --- accuracy on synthetic rolls (the issue's acceptance criteria) -----------------


def test_committed_fixture_is_read_exactly() -> None:
    result = extract_roll(FIXTURES / "small.pdf", workers=2)
    truth = RollTruth.model_validate_json((FIXTURES / "small.json").read_text("utf-8"))
    accuracy = compare(result, truth)
    assert accuracy.wrong == []
    assert [r.values() for r in result.rows] == truth.voters
    assert result.extracted_totals == truth.printed_totals.counts
    assert not result.needs_review


@pytest.mark.parametrize("preset", ["ac40", "ac40-degraded"])
def test_accuracy_on_a_full_part(
    preset: str, extracted_roll: Callable[[str], tuple[RollExtraction, RollTruth]]
) -> None:
    result, truth = extracted_roll(preset)
    accuracy = compare(result, truth)
    print(accuracy.report())  # shown with pytest -s

    assert accuracy.boxes_found == accuracy.boxes_expected == 571
    for name in ("gender", "age", "serial", "epic"):
        assert accuracy.rate(name) >= 0.99, name
    for name in ("name", "relative_name"):
        assert accuracy.rate(name) >= 0.98, name
    assert accuracy.unflagged == []  # every wrong value is flagged on its row


def test_totals_check_passes_on_the_clean_part(
    extracted_roll: Callable[[str], tuple[RollExtraction, RollTruth]],
) -> None:
    result, truth = extracted_roll("ac40")
    assert result.extracted_totals == truth.printed_totals.counts
    assert result.issues == []
    assert not result.needs_review
    assert result.quality_score > 0.7


def test_a_part_takes_under_a_minute(
    extracted_roll: Callable[[str], tuple[RollExtraction, RollTruth]],
) -> None:
    result, _ = extracted_roll("ac40")
    assert result.timings.total_seconds < 60


def test_rare_prefixes_are_flagged(
    extracted_roll: Callable[[str], tuple[RollExtraction, RollTruth]],
) -> None:
    result, truth = extracted_roll("ac40")
    rare = {v.epic[:3] for v in truth.voters} - {
        p
        for p in {v.epic[:3] for v in truth.voters}
        if sum(v.epic[:3] == p for v in truth.voters) > 1
    }
    flagged = {
        r.epic.value[:3]
        for r in result.rows
        if r.epic.value and any(i.code == "epic.rare_prefix" for i in r.issues)
    }
    assert rare and flagged == rare


def test_extract_command(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "result.json"
    assert main(["extract", str(FIXTURES / "small.pdf"), "--out", str(out), "--workers", "1"]) == 0
    printed = capsys.readouterr().out
    assert "extracted: 19 male / 20 female / 1 third gender / 40 total" in printed
    assert "voter rows: 42" in printed
    # No voter data on the console
    truth = RollTruth.model_validate_json((FIXTURES / "small.json").read_text("utf-8"))
    assert all(v.name not in printed and v.epic not in printed for v in truth.voters)
    assert RollExtraction.model_validate_json(out.read_text("utf-8")).rows


def test_serial_and_epic_dont_depend_on_fixed_positions(
    extracted_roll: Callable[[str], tuple[RollExtraction, RollTruth]],
) -> None:
    """A different serial/EPIC row: the serial frame in the box's corner and a
    frame round the EPIC (the real sample's printed serials mostly disagreed
    with reading order when the crops were fixed fractions of the box)."""
    result, truth = extracted_roll("small-framed")
    accuracy = compare(result, truth)
    assert accuracy.boxes_found == accuracy.boxes_expected
    assert accuracy.rate("serial") == 1.0
    assert accuracy.rate("epic") == 1.0
    assert not any(r.printed_serial.value != r.serial for r in result.rows)
    assert "serial.many_mismatches" not in {i.code for i in result.issues}


def test_id_crops_command(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "crops.png"
    assert main(["id-crops", str(FIXTURES / "small.pdf"), "--page", "3", "--out", str(out)]) == 0
    assert "24 boxes; serial or EPIC not found in 0" in capsys.readouterr().out
    assert out.stat().st_size > 0


def test_the_valid_epic_reading_is_kept() -> None:
    """The glyph crop and the fixed strip are both read; a reading that cut
    the EPIC short loses to one that holds all 10 characters."""
    from roll_parser.extract.roll import _best_epic
    from roll_parser.ocr import Line, PageWord, line_from_words

    def line(text: str) -> Line:
        return (
            line_from_words([PageWord(text, 0.9, 0, 0, 10, 10)]) if text else Line("", (), 0, 0, 0)
        )

    assert _best_epic([line("1234567"), line("ABC1234567")]).text == "ABC1234567"
    assert _best_epic([line("ABC1234567"), line("XYZ7654321")]).text == "ABC1234567"
    assert _best_epic([line(""), line("ABC12345")]).text == "ABC12345"  # flagged later
