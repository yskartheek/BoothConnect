"""Draws a synthetic roll and turns it into an image-only PDF.

``draw_vector`` lays the pages out with real text (handy for checking the
ground truth); ``rasterise`` then replaces every page with one grayscale JPEG,
like the published rolls, optionally degraded (blur, rotation, noise, lower
JPEG quality) to test the parser's robustness.
"""

import random
from datetime import date

import cv2
import numpy as np
import pymupdf
from pydantic import BaseModel, ConfigDict

from roll_parser.model import EntryMarker, RollTruth, VoterEntry
from roll_parser.synthetic import layout
from roll_parser.synthetic.data import GENDER_LABELS, RELATION_LABELS

BLACK = (0.0, 0.0, 0.0)
GREY = (0.55, 0.55, 0.55)
LIGHT = (0.85, 0.85, 0.85)


class Degradation(BaseModel):
    """Image damage applied to every page after rendering."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    jpeg_quality: int = 85
    blur_sigma: float = 0.0  # Gaussian blur, in pixels
    max_rotation_deg: float = 0.0  # each page turns by up to this much
    noise_sigma: float = 0.0  # Gaussian noise, in grey levels


def _fmt_date(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def _text(
    page: pymupdf.Page,
    x: float,
    y: float,
    text: str,
    *,
    size: float = 9,
    bold: bool = False,
    align: str = "left",
    color: tuple[float, float, float] = BLACK,
) -> None:
    if align != "left":
        width = layout.text_width(text, size=size, bold=bold)
        x -= width if align == "right" else width / 2
    font = layout.FONT_BOLD if bold else layout.FONT
    page.insert_text((x, y), text, fontsize=size, fontname=font, color=color)


def _table(
    page: pymupdf.Page, x0: float, y0: float, widths: list[float], rows: list[list[str]]
) -> float:
    """Bordered table; the first row is the header. Returns the bottom y."""
    row_h = 18.0
    for r, row in enumerate(rows):
        x = x0
        for width, cell in zip(widths, row, strict=True):
            rect = pymupdf.Rect(x, y0 + r * row_h, x + width, y0 + (r + 1) * row_h)
            page.draw_rect(rect, color=BLACK, width=0.6)
            _text(page, rect.x0 + width / 2, rect.y1 - 5.5, cell, bold=r == 0, align="center")
            x += width
    return y0 + len(rows) * row_h


def _heading(page: pymupdf.Page, y: float, text: str) -> None:
    rect = pymupdf.Rect(layout.MARGIN_X, y - 11, layout.PAGE_WIDTH - layout.MARGIN_X, y + 4)
    page.draw_rect(rect, color=BLACK, fill=LIGHT, width=0.6)
    _text(page, rect.x0 + 4, y, text, size=9.5, bold=True)


def _counts_row(label: str, truth: RollTruth, index: int) -> list[str]:
    c = truth.summary[index].counts
    return [label, str(c.male), str(c.female), str(c.third_gender), str(c.total)]


def _draw_cover(page: pymupdf.Page, truth: RollTruth) -> None:
    h = truth.header
    left = layout.MARGIN_X + 4
    right = layout.PAGE_WIDTH - layout.MARGIN_X - 4
    mid = layout.PAGE_WIDTH / 2

    _text(page, mid, 40, f"ELECTORAL ROLL, {h.revision_year}", size=14, bold=True, align="center")
    _text(
        page,
        mid,
        58,
        f"STATE - ({h.state_code}) {h.state_name}",
        size=11,
        bold=True,
        align="center",
    )
    _text(
        page,
        left,
        84,
        "No., Name and Reservation Status of Assembly Constituency : "
        f"{h.ac_number} - {h.ac_name} ({h.ac_reservation})",
        size=8.5,
    )
    _text(page, right, 84, f"Part No. : {h.part_number}", size=10, bold=True, align="right")
    _text(
        page,
        left,
        98,
        "No., Name and Reservation Status of Parliamentary Constituency(ies) in which the "
        f"Assembly Constituency is located : {h.pc_number} - {h.pc_name} ({h.pc_reservation})",
        size=7.5,
    )

    _heading(page, 124, "1. DETAILS OF REVISION")
    _text(page, left, 142, f"Year of Revision : {h.revision_year}", size=8.5)
    _text(page, left + 150, 142, f"Type of Revision : {h.revision_type}", size=8.5)
    _text(page, left, 156, f"Qualifying Date : {_fmt_date(h.qualifying_date)}", size=8.5)
    _text(page, left + 150, 156, f"Date of Publication : {_fmt_date(h.publication_date)}", size=8.5)
    _text(page, left, 170, f"Roll Identification : {h.roll_identification}", size=8.5)

    _heading(page, 196, "2. DETAILS OF PART & POLLING AREA")
    _text(page, left, 214, "No. and Name of Sections in the part :", size=8.5, bold=True)
    y = 228.0
    for section in h.sections:
        _text(page, left + 8, y, f"{section.number} - {section.name}", size=8.5)
        y += 13
    col = mid + 20
    details = [
        ("Main Town or Village", h.main_town),
        ("Post Office", h.post_office),
        ("Police Station", h.police_station),
        ("Mandal", h.mandal),
        ("District", h.district),
        ("Pin Code", h.pin_code),
    ]
    for i, (label, value) in enumerate(details):
        _text(page, col, 214 + i * 14, f"{label} : {value}", size=8.5)
    y = max(y, 214 + len(details) * 14) + 16

    _heading(page, y, "3. POLLING STATION DETAILS")
    y += 18
    station = h.polling_station
    _text(
        page,
        left,
        y,
        f"No. and Name of Polling Station : {station.number} - {station.name}",
        size=8.5,
    )
    _text(page, left, y + 14, f"Address of Polling Station : {station.address}", size=8.5)
    _text(page, left, y + 28, f"Type of Polling Station : {h.station_type}", size=8.5)
    _text(
        page,
        left,
        y + 42,
        f"Number of Auxiliary Polling Stations in this Part : {h.auxiliary_station_count}",
        size=8.5,
    )
    y += 56
    for aux in h.auxiliary_stations:
        _text(page, left + 8, y, f"{aux.number} - {aux.name}", size=8.5)
        _text(page, left + 8, y + 12, f"Address : {aux.address}", size=7.5)
        y += 28

    _heading(page, y + 10, "4. NUMBER OF ELECTORS")
    t = truth.printed_totals
    _table(
        page,
        left,
        y + 24,
        [95, 95, 80, 80, 90, 80],
        [
            ["Starting Serial No.", "Ending Serial No.", "Male", "Female", "Third Gender", "Total"],
            [
                str(t.start_serial),
                str(t.end_serial),
                str(t.counts.male),
                str(t.counts.female),
                str(t.counts.third_gender),
                str(t.counts.total),
            ],
        ],
    )


def _draw_maps(page: pymupdf.Page, truth: RollTruth) -> None:
    """Placeholder for the maps and building photos page (never extracted)."""
    h = truth.header
    _text(
        page,
        layout.PAGE_WIDTH / 2,
        40,
        "MAPS AND PHOTOGRAPHS OF THE POLLING STATION",
        size=12,
        bold=True,
        align="center",
    )
    _text(page, layout.PAGE_WIDTH / 2, 56, f"Part No. : {h.part_number}", size=9, align="center")
    labels = ["NAZRI NAKSHA", "GOOGLE MAP", "BUILDING PHOTO", "KEY MAP"]
    w = (layout.PAGE_WIDTH - 2 * layout.MARGIN_X - 12) / 2
    for i, label in enumerate(labels):
        row, col = divmod(i, 2)
        x0 = layout.MARGIN_X + col * (w + 12)
        y0 = 80 + row * 370
        rect = pymupdf.Rect(x0, y0, x0 + w, y0 + 350)
        page.draw_rect(rect, color=BLACK, fill=(0.93, 0.93, 0.93), width=0.8)
        # Hatching stands in for the picture
        for k in range(0, 700, 18):
            start = (x0 + min(k, w), y0 + max(0, k - w))
            end = (x0 + max(0, k - 350), y0 + min(k, 350))
            page.draw_line(start, end, color=LIGHT, width=0.5)
        _text(page, rect.x0 + w / 2, rect.y1 - 10, label, size=9, bold=True, align="center")


def _draw_voter_box(page: pymupdf.Page, voter: VoterEntry) -> None:
    r = layout.box_rect(voter.box_index)
    w = r.width
    page.draw_rect(r, color=BLACK, width=0.8)

    serial_box = pymupdf.Rect(r.x0 + 0.05 * w, r.y0 + 2, r.x0 + 0.30 * w, r.y0 + 13)
    page.draw_rect(serial_box, color=BLACK, width=0.6)
    _text(
        page,
        serial_box.x0 + serial_box.width / 2,
        serial_box.y1 - 2.5,
        str(voter.serial),
        size=8,
        bold=True,
        align="center",
    )
    _text(page, r.x0 + 0.96 * w, r.y0 + 11, voter.epic, size=8.5, bold=True, align="right")

    photo = pymupdf.Rect(
        r.x0 + layout.PHOTO_LEFT * w, r.y0 + 0.2 * r.height, r.x0 + 0.97 * w, r.y1 - 0.05 * r.height
    )
    page.draw_rect(photo, color=GREY, width=0.5)
    cx, cy = photo.x0 + photo.width / 2, photo.y0 + photo.height / 2
    if voter.marker is None:
        _text(page, cx, cy - 1, "Photo", size=6.5, align="center", color=GREY)
        _text(page, cx, cy + 7, "Available", size=6.5, align="center", color=GREY)
    else:
        label = "DELETED" if voter.marker is EntryMarker.DELETED else "MODIFIED"
        _text(page, cx, cy + 3, label, size=7, bold=True, align="center")

    lines = [
        *layout.wrap_field("Name", voter.name),
        *layout.wrap_field(RELATION_LABELS[voter.relation_type], voter.relative_name),
        f"House Number : {voter.house_number}",
    ]
    x = r.x0 + layout.BODY_LEFT * w
    y = r.y0 + layout.BODY_TOP
    for line in lines:
        indent = 0.0 if " : " in line else layout.LABEL_INDENT
        _text(page, x + indent, y, line, size=layout.BODY_SIZE)
        y += layout.BODY_LINE
    _text(page, x, y, f"Age : {voter.age}", size=layout.BODY_SIZE)
    _text(page, x + 0.24 * w, y, f"Gender : {GENDER_LABELS[voter.gender]}", size=layout.BODY_SIZE)


def _draw_voter_page(
    page: pymupdf.Page, truth: RollTruth, number: int, voters: list[VoterEntry]
) -> None:
    h = truth.header
    left = layout.MARGIN_X + 4
    right = layout.PAGE_WIDTH - layout.MARGIN_X - 4
    section = next(s for s in h.sections if s.number == voters[0].section_number)
    page.draw_rect(
        pymupdf.Rect(layout.MARGIN_X, 18, layout.PAGE_WIDTH - layout.MARGIN_X, 54),
        color=BLACK,
        width=0.6,
    )
    _text(
        page,
        left,
        32,
        f"Assembly Constituency No and Name : {h.ac_number}-{h.ac_name}",
        size=8.5,
        bold=True,
    )
    _text(page, right, 32, f"Part No. : {h.part_number}", size=8.5, bold=True, align="right")
    _text(
        page,
        left,
        48,
        f"Section No and Name : {section.number}-{section.name}",
        size=8.5,
        bold=True,
    )
    for voter in voters:
        _draw_voter_box(page, voter)
    _draw_footer(page, truth, number)


def _draw_summary(page: pymupdf.Page, truth: RollTruth, number: int) -> None:
    h = truth.header
    left = layout.MARGIN_X + 4
    _text(
        page, layout.PAGE_WIDTH / 2, 40, "SUMMARY OF ELECTORS", size=13, bold=True, align="center"
    )
    _text(
        page, left, 66, f"Assembly Constituency No and Name : {h.ac_number}-{h.ac_name}", size=8.5
    )
    _text(page, left, 80, f"Part No. : {h.part_number}", size=8.5)
    _heading(page, 108, "NUMBER OF ELECTORS")
    rows = [["Roll Type", "Male", "Female", "Third Gender", "Total"]]
    rows += [_counts_row(row.roll_type, truth, i) for i, row in enumerate(truth.summary)]
    c = truth.printed_totals.counts
    rows.append(["Total", str(c.male), str(c.female), str(c.third_gender), str(c.total)])
    _table(page, left, 124, [150, 80, 80, 90, 80], rows)
    _draw_footer(page, truth, number)


def _draw_footer(page: pymupdf.Page, truth: RollTruth, number: int) -> None:
    y = layout.PAGE_HEIGHT - 20
    publication = _fmt_date(truth.header.publication_date)
    _text(page, layout.MARGIN_X + 4, y, f"Date of Publication : {publication}", size=7)
    _text(
        page,
        layout.PAGE_WIDTH - layout.MARGIN_X - 4,
        y,
        f"Total Pages {len(truth.pages)} - Page {number}",
        size=7,
        align="right",
    )


def draw_vector(truth: RollTruth) -> pymupdf.Document:
    """Lay out the roll as a PDF with a text layer."""
    doc = pymupdf.open()
    by_page: dict[int, list[VoterEntry]] = {}
    for voter in truth.voters:
        by_page.setdefault(voter.page, []).append(voter)

    for number, kind in enumerate(truth.pages, start=1):
        page = doc.new_page(width=layout.PAGE_WIDTH, height=layout.PAGE_HEIGHT)
        if kind == "cover":
            _draw_cover(page, truth)
        elif kind == "maps":
            _draw_maps(page, truth)
        elif kind == "voters":
            _draw_voter_page(page, truth, number, by_page[number])
        else:
            _draw_summary(page, truth, number)
    return doc


def _degrade(image: np.ndarray, degradation: Degradation, rng: random.Random) -> np.ndarray:
    out = image
    if degradation.max_rotation_deg:
        angle = rng.uniform(-degradation.max_rotation_deg, degradation.max_rotation_deg)
        h, w = out.shape
        matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        out = cv2.warpAffine(out, matrix, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)
    if degradation.blur_sigma:
        out = cv2.GaussianBlur(out, (0, 0), degradation.blur_sigma)
    if degradation.noise_sigma:
        noise = np.random.default_rng(rng.randrange(2**32)).normal(
            0, degradation.noise_sigma, out.shape
        )
        out = np.clip(out.astype(np.float64) + noise, 0, 255).astype(np.uint8)
    return out


def rasterise(
    vector: pymupdf.Document, degradation: Degradation | None = None, *, seed: int = 0
) -> pymupdf.Document:
    """Replace every page with one grayscale JPEG, like the published rolls."""
    degradation = degradation or Degradation()
    rng = random.Random(seed)
    out = pymupdf.open()
    for page in vector.pages():
        pix = page.get_pixmap(dpi=layout.RENDER_DPI, colorspace=pymupdf.csGRAY)
        image = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w)
        image = _degrade(image, degradation, rng)
        ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, degradation.jpeg_quality])
        if not ok:  # pragma: no cover
            raise RuntimeError("JPEG encoding failed")
        target = out.new_page(width=page.rect.width, height=page.rect.height)
        target.insert_image(target.rect, stream=jpeg.tobytes())
    return out
