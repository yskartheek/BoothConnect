"""The synthetic roll generator: fake data, layout and ground truth agree."""

import re
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np
import pymupdf
import pytest

from roll_parser import ocr, synthetic
from roll_parser.cli import main
from roll_parser.model import EntryMarker, Gender, PageKind, RelationType, RollTruth
from roll_parser.synthetic import layout
from roll_parser.synthetic.data import GENDER_LABELS, RELATION_LABELS

from .conftest import FIXTURES, SyntheticRoll

SMALL = synthetic.PRESETS["small"]
AC40 = synthetic.PRESETS["ac40"]


def squash(text: str) -> str:
    """Join wrapped lines and collapse whitespace."""
    return " ".join(text.split())


# --- fake data ---------------------------------------------------------------


def test_same_seed_gives_same_roll() -> None:
    assert synthetic.generate(SMALL.spec) == synthetic.generate(SMALL.spec)
    other = SMALL.spec.model_copy(update={"seed": 2})
    assert synthetic.generate(other).voters != synthetic.generate(SMALL.spec).voters


@pytest.mark.parametrize("preset", ["small", "ac40"])
def test_totals_count_every_entry_except_deleted(preset: str) -> None:
    truth = synthetic.generate(synthetic.PRESETS[preset].spec)
    active = [v for v in truth.voters if v.marker is not EntryMarker.DELETED]
    genders = Counter(v.gender for v in active)
    counts = truth.printed_totals.counts
    assert (counts.male, counts.female, counts.third_gender) == (
        genders[Gender.MALE],
        genders[Gender.FEMALE],
        genders[Gender.THIRD_GENDER],
    )
    assert counts.total == len(active)
    assert truth.printed_totals.start_serial == 1
    assert truth.printed_totals.end_serial == len(truth.voters)
    assert [row.counts for row in truth.summary] == [counts]


def test_ac40_matches_the_owners_sample_shape() -> None:
    truth = synthetic.generate(AC40.spec)
    h = truth.header
    assert (h.ac_number, h.ac_name, h.ac_reservation) == (40, "PATANCHERU", "GENERAL")
    assert (h.pc_number, h.pc_name, h.pc_reservation) == (6, "MEDAK", "GEN")
    assert h.part_number == 408
    assert len(truth.pages) == 23
    assert truth.printed_totals.counts.total == 571


def test_small_covers_the_awkward_cases() -> None:
    truth = synthetic.generate(SMALL.spec)
    voters = truth.voters
    assert [v.serial for v in voters] == list(range(1, len(voters) + 1))
    assert {v.relation_type for v in voters} == set(RelationType)
    assert Counter(v.marker for v in voters) == {None: 39, "deleted": 2, "modified": 1}
    assert sum(v.gender is Gender.THIRD_GENDER for v in voters) == 1
    assert len(truth.header.sections) == 2
    assert [s.number for s in truth.header.auxiliary_stations] == ["408A"]
    assert truth.header.auxiliary_station_count == 1
    assert any(len(layout.wrap_field("Name", v.name)) == 2 for v in voters)
    assert truth.pages == ["cover", "maps", "voters", "voters", "summary"]


@pytest.mark.parametrize("preset", ["small", "ac40"])
def test_epics_are_unique_and_prefixes_vary(preset: str) -> None:
    truth = synthetic.generate(synthetic.PRESETS[preset].spec)
    epics = [v.epic for v in truth.voters]
    assert len(set(epics)) == len(epics)
    assert all(re.fullmatch(r"[A-Z]{3}\d{7}", e) for e in epics)
    prefixes = Counter(e[:3] for e in epics)
    assert len(prefixes) >= 3
    assert (
        sum(n == 1 for n in prefixes.values()) >= synthetic.PRESETS[preset].spec.rare_epic_prefixes
    )


def test_husbands_are_only_named_for_women() -> None:
    truth = synthetic.generate(AC40.spec)
    for v in truth.voters:
        if v.relation_type is RelationType.HUSBAND:
            assert v.gender is Gender.FEMALE
        assert 18 <= v.age <= 100


def test_sections_start_on_a_new_page() -> None:
    truth = synthetic.generate(AC40.spec)
    first_of_section2 = next(v for v in truth.voters if v.section_number == 2)
    assert first_of_section2.box_index == 0
    for page in {v.page for v in truth.voters}:
        assert len({v.section_number for v in truth.voters if v.page == page}) == 1


# --- round trip: what's drawn is what the ground truth says -----------------


@pytest.mark.parametrize("preset", ["small", "ac40"])
def test_every_box_shows_its_ground_truth(preset: str) -> None:
    truth = synthetic.generate(synthetic.PRESETS[preset].spec)
    doc = synthetic.draw_vector(truth)
    for v in truth.voters:
        page = doc[v.page - 1]
        text = squash(page.get_text("text", clip=layout.box_rect(v.box_index)))
        assert f"Name : {v.name} " in text
        assert f"{RELATION_LABELS[v.relation_type]} : {v.relative_name} " in text
        assert f"House Number : {v.house_number} " in text
        assert f"Age : {v.age} " in text
        assert f"Gender : {GENDER_LABELS[v.gender]}" in text
        assert text.startswith(f"{v.serial} {v.epic} ")
        marker = {None: "Photo Available", "deleted": "DELETED", "modified": "MODIFIED"}
        assert marker[v.marker] in text
    # Nothing is drawn where the ground truth has no voter
    drawn = sum(len(re.findall(r"House Number :", p.get_text())) for p in doc.pages())
    assert drawn == len(truth.voters)


def test_cover_voter_and_summary_pages_show_the_header() -> None:
    truth = synthetic.generate(SMALL.spec)
    h = truth.header
    doc = synthetic.draw_vector(truth)
    cover = squash(doc[0].get_text())
    for expected in [
        "STATE - (S29) TELANGANA",
        "Assembly Constituency : 40 - PATANCHERU (GENERAL)",
        "is located : 6 - MEDAK (GEN)",
        "Part No. : 408",
        "Qualifying Date : 01-01-2026",
        "Date of Publication : 10-02-2026",
        f"1 - {h.sections[0].name}",
        f"2 - {h.sections[1].name}",
        f"Pin Code : {h.pin_code}",
        f"No. and Name of Polling Station : 408 - {h.polling_station.name}",
        "Number of Auxiliary Polling Stations in this Part : 1",
        f"408A - {h.auxiliary_stations[0].name}",
        "Male Female Third Gender Total 1 42 19 20 1 40",
    ]:
        assert expected in cover
    maps = squash(doc[1].get_text())
    assert "NAZRI NAKSHA" in maps
    assert "Name :" not in maps  # no voter data on the maps page
    voters_page = squash(doc[3].get_text())
    assert f"Section No and Name : 2-{h.sections[1].name}" in voters_page
    assert "Total Pages 5 - Page 4" in voters_page
    assert "Mother Roll 19 20 1 40 Total 19 20 1 40" in squash(doc[4].get_text())


# --- image-only output ------------------------------------------------------


def test_output_is_image_only_like_the_real_rolls(
    synthetic_roll: Callable[[str], SyntheticRoll],
) -> None:
    pdf, truth = synthetic_roll("small")
    doc = pymupdf.open(pdf)
    assert doc.page_count == len(truth.pages)
    for page in doc.pages():
        assert page.get_text().strip() == ""
        (image,) = page.get_images()
        assert image[2:4] == (1984, 2807)


def test_degradation_changes_the_pixels() -> None:
    truth = synthetic.generate(SMALL.spec)
    vector = synthetic.draw_vector(truth)
    vector.select([2])
    clean = synthetic.rasterise(vector)
    damaged = synthetic.rasterise(
        vector,
        synthetic.Degradation(jpeg_quality=50, blur_sigma=1.0, max_rotation_deg=1, noise_sigma=8),
    )

    def pixels(doc: pymupdf.Document) -> np.ndarray:
        pix = doc[0].get_pixmap(dpi=72, colorspace=pymupdf.csGRAY)
        return np.frombuffer(pix.samples, np.uint8).astype(np.int16)

    assert np.abs(pixels(clean) - pixels(damaged)).mean() > 2


def test_ocr_can_read_a_rendered_box(synthetic_roll: Callable[[str], SyntheticRoll]) -> None:
    pdf, truth = synthetic_roll("small")
    voter = next(v for v in truth.voters if v.marker is None and v.page == 3)
    scale = layout.RENDER_DPI / 72
    r = layout.box_rect(voter.box_index) * scale
    pix = pymupdf.open(pdf)[voter.page - 1].get_pixmap(
        dpi=layout.RENDER_DPI, colorspace=pymupdf.csGRAY
    )
    page = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w)
    body = page[int(r.y0 + 0.2 * r.height) : int(r.y1), int(r.x0) : int(r.x0 + 0.72 * r.width)]
    binary = cv2.threshold(body, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1].astype(np.uint8)
    text = squash(ocr.read_block(binary))
    assert voter.name in text
    assert f"Age : {voter.age}" in text


# --- committed fixture and CLI -----------------------------------------------


def test_committed_fixture_matches_the_generator() -> None:
    """If this fails, the generator changed: regenerate the fixture (see README)."""
    committed = RollTruth.model_validate_json((FIXTURES / "small.json").read_text("utf-8"))
    assert committed == synthetic.generate(SMALL.spec)
    doc = pymupdf.open(FIXTURES / "small.pdf")
    assert doc.page_count == len(committed.pages) == 5
    assert all(page.get_text().strip() == "" for page in doc.pages())


def test_page_kinds_line_up_with_voters() -> None:
    truth = synthetic.generate(SMALL.spec)
    for v in truth.voters:
        assert truth.pages[v.page - 1] is PageKind.VOTERS


def test_synth_command_writes_pdf_and_truth(tmp_path: Path) -> None:
    assert main(["synth", "small", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "small.pdf").read_bytes().startswith(b"%PDF")
    truth = RollTruth.model_validate_json((tmp_path / "small.json").read_text("utf-8"))
    assert len(truth.voters) == 42
