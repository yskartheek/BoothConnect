"""Draws a synthetic roll and turns it into an image-only PDF.

``draw_vector`` lays the pages out with real text (handy for checking the
ground truth); ``rasterise`` then replaces every page with one grayscale JPEG,
like the published rolls, optionally degraded (blur, rotation, noise, lower
JPEG quality) to test the parser's robustness.
"""

import random
from datetime import date
from typing import Literal

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


# How a box's serial/EPIC row is drawn: "plain" as in the spike, "framed" with
# the serial frame in the box's corner and a frame round the EPIC (a different
# geometry, to check the parser doesn't depend on fixed positions)
BoxStyle = Literal["plain", "framed"]


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


def _wrap(text: str, width: float, *, size: float = 8.5) -> list[str]:
    """Split ``text`` into lines no wider than ``width`` points."""
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and layout.text_width(candidate, size=size) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    return [*lines, current]


def _draw_cover(page: pymupdf.Page, truth: RollTruth) -> None:
    """Laid out like the owner's 2026 S29 sample cover: two-column sections,
    a colon-less revision table, values under or beside their labels."""
    h = truth.header
    left = layout.MARGIN_X + 4
    right = layout.PAGE_WIDTH - layout.MARGIN_X - 4
    mid = layout.PAGE_WIDTH / 2
    col = mid + 20  # right-hand column
    size = 8.5

    _text(page, mid, 40, f"ELECTORAL ROLL {h.revision_year}", size=14, bold=True, align="center")
    _text(page, right, 40, f"{h.state_code} {h.state_name}", size=11, bold=True, align="right")
    _text(
        page,
        left,
        68,
        "No. Name and Reservation Status of Assembly Constituency : "
        f"{h.ac_number} - {h.ac_name} ({h.ac_reservation})",
        size=size,
    )
    _text(page, right, 68, f"Part No. : {h.part_number}", size=10, bold=True, align="right")
    _text(
        page,
        left,
        84,
        "No. Name and Reservation Status of Parliamentary Constituency : "
        f"{h.pc_number} - {h.pc_name} ({h.pc_reservation})",
        size=size,
    )

    # 1. Revision: label | value table on the left, roll identification on the right
    _heading(page, 110, "1. Details of Revision")
    value_x = left + 110
    y = 130.0
    _text(page, left, y, "Year of Revision", size=size)
    _text(page, value_x, y, str(h.revision_year), size=size)
    _text(page, col + 40, y, "Roll Identification", size=size, bold=True)
    for i, line in enumerate(_wrap(h.roll_identification, right - col - 40)):
        _text(page, col + 40, y + 13 + i * 11, line, size=size)
    y += 26
    _text(page, left, y, "Qualifying Date", size=size)
    _text(page, value_x, y, _fmt_date(h.qualifying_date), size=size)
    y += 26
    _text(page, left, y, "Type of revision", size=size)
    type_lines = _wrap(h.revision_type, mid - value_x - 10)
    for i, line in enumerate(type_lines):
        _text(page, value_x, y + i * 12, line, size=size)
    y += 14 + 12 * len(type_lines)
    _text(page, left, y, "Date of Publication", size=size)
    _text(page, value_x, y, _fmt_date(h.publication_date), size=size)

    # 2. Sections on the left, place details on the right (lines share baselines)
    y += 28
    _heading(page, y, "2. Details of part and polling area")
    y += 18
    _text(page, left, y, "No. and name of sections in the part", size=size)
    details = [
        ("Main Town or Village", h.main_town),
        ("Post Office", h.post_office),
        ("Police Station", h.police_station),
        ("Tehsil/Mandal", h.mandal),
        *([("Subdivision", h.subdivision)] if h.subdivision else []),
        ("District", h.district),
        ("Pin code", h.pin_code),
    ]
    for i, section in enumerate(h.sections):
        _text(page, left + 4, y + 14 * (i + 1), f"{section.number}-{section.name}", size=size)
    for i, (label, value) in enumerate(details):
        _text(page, col, y + 14 * (i + 1), f"{label} : {value}", size=size)
    y += 14 * (max(len(details), len(h.sections)) + 1) + 16

    # 3. Station: number and name under the label, type and auxiliary count beside it
    _heading(page, y, "3. Polling station details")
    y += 18
    station = h.polling_station
    _text(page, left, y, "No. and Name of Polling Station :", size=size)
    _text(page, col, y, "Type of Polling Station", size=size)
    _text(page, right, y, h.station_type, size=size, bold=True, align="right")
    _text(page, col, y + 12, "(Male/Female/General)", size=7.5)
    name_lines = _wrap(f"{station.number} - {station.name}", mid - left - 60)
    for i, line in enumerate(name_lines):
        _text(page, left, y + 26 + 12 * i, line, size=size)
    aux_y = y + 26 + 12 * (len(name_lines) - 1)
    _text(page, col, aux_y, "Number of Auxiliary Polling", size=size)
    _text(page, right, aux_y, str(h.auxiliary_station_count), size=size, bold=True, align="right")
    _text(page, col, aux_y + 12, "Stations in this part:", size=size)
    y = aux_y + 30
    _text(page, left, y, "Address of Polling Station :", size=size)
    for line in _wrap(station.address, right - left):
        y += 12
        _text(page, left, y, line, size=size)
    y += 8
    for aux in h.auxiliary_stations:
        _text(page, left + 8, y + 12, f"{aux.number} - {aux.name}", size=size)
        _text(page, left + 8, y + 24, f"Address : {aux.address}", size=7.5)
        y += 28

    # 4. Totals: two header lines, then the numbers
    _heading(page, y + 20, "4. NUMBER OF ELECTORS")
    t = truth.printed_totals
    widths = [85.0, 85.0, 80.0, 80.0, 90.0, 80.0]
    xs = [left + sum(widths[:i]) for i in range(len(widths) + 1)]
    top = y + 34
    rows = [top, top + 30, top + 48]
    page.draw_rect(pymupdf.Rect(xs[0], rows[0], xs[-1], rows[2]), color=BLACK, width=0.6)
    page.draw_line((xs[0], rows[1]), (xs[-1], rows[1]), color=BLACK, width=0.6)
    page.draw_line((xs[2], top + 15), (xs[-1], top + 15), color=BLACK, width=0.6)
    for i, x in enumerate(xs[1:-1], start=1):
        page.draw_line((x, top if i <= 2 else top + 15), (x, rows[2]), color=BLACK, width=0.6)

    def centre(i: int, y_text: float, text: str, *, bold: bool = True) -> None:
        _text(page, (xs[i] + xs[i + 1]) / 2, y_text, text, size=size, bold=bold, align="center")

    centre(0, top + 11, "Starting")
    centre(1, top + 11, "Ending")
    _text(
        page, (xs[2] + xs[-1]) / 2, top + 11, "Net Electors", size=size, bold=True, align="center"
    )
    headers = ["Serial No.", "Serial No.", "Male", "Female", "Third Gender", "Total"]
    for i, text in enumerate(headers):
        centre(i, top + 26, text)
    numbers = [t.start_serial, t.end_serial, *t.counts.model_dump().values()]
    for i, number in enumerate(numbers):
        centre(i, rows[2] - 5, str(number), bold=False)

    _text(
        page,
        right,
        rows[2] + 60,
        "Signature of Electoral Registration Officer",
        size=8,
        align="right",
    )
    _text(
        page,
        right,
        layout.PAGE_HEIGHT - 20,
        f"Total Pages {len(truth.pages)} - Page 1",
        size=7,
        align="right",
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


def _draw_voter_box(page: pymupdf.Page, voter: VoterEntry, style: BoxStyle) -> None:
    r = layout.box_rect(voter.box_index)
    w = r.width
    page.draw_rect(r, color=BLACK, width=0.8)

    if style == "framed":
        # Serial frame sharing the box's top-left corner; the EPIC in a frame too
        serial_box = pymupdf.Rect(r.x0, r.y0, r.x0 + 0.2 * w, r.y0 + 13)
        epic_box = pymupdf.Rect(r.x0 + 0.52 * w, r.y0 + 2, r.x0 + 0.97 * w, r.y0 + 14)
        page.draw_rect(epic_box, color=BLACK, width=0.6)
        epic_x, epic_y, epic_align = epic_box.x0 + epic_box.width / 2, epic_box.y1 - 3, "center"
    else:
        serial_box = pymupdf.Rect(r.x0 + 0.05 * w, r.y0 + 2, r.x0 + 0.30 * w, r.y0 + 13)
        epic_x, epic_y, epic_align = r.x0 + 0.96 * w, r.y0 + 11, "right"
    page.draw_rect(serial_box, color=BLACK, width=0.6)
    _text(
        page,
        serial_box.x0 + serial_box.width / 2,
        serial_box.y1 - (3 if style == "framed" else 2.5),
        str(voter.serial),
        size=8,
        bold=True,
        align="center",
    )
    _text(page, epic_x, epic_y, voter.epic, size=8.5, bold=True, align=epic_align)

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
    page: pymupdf.Page, truth: RollTruth, number: int, voters: list[VoterEntry], style: BoxStyle
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
        _draw_voter_box(page, voter, style)
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


def draw_vector(truth: RollTruth, box_style: BoxStyle = "plain") -> pymupdf.Document:
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
            _draw_voter_page(page, truth, number, by_page[number], box_style)
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
