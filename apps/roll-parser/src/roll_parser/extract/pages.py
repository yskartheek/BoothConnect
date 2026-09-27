"""Page classification: cover, maps/photos, voter pages, summary.

Only the top strip of each page is read to decide. The maps and photos page
is never read beyond that, and nothing from it is kept.
"""

import re

import pymupdf

from roll_parser.extract.images import render
from roll_parser.model import PageKind
from roll_parser.ocr import read_block

TOP_STRIP = 0.12  # share of the page height holding the title or page header
CLASSIFY_DPI = 150


def page_title(page: pymupdf.Page) -> str:
    r = page.rect
    strip = render(
        page, dpi=CLASSIFY_DPI, clip=pymupdf.Rect(r.x0, r.y0, r.x1, r.y0 + r.height * TOP_STRIP)
    )
    return " ".join(read_block(strip).split())


def classify_title(title: str) -> PageKind | None:
    if re.search(r"Section\s*No", title, re.I):
        return PageKind.VOTERS
    if re.search(r"ELECTORAL\s*ROLL", title, re.I):
        return PageKind.COVER
    if re.search(r"SUMMARY", title, re.I):
        return PageKind.SUMMARY
    return None


def classify(doc: pymupdf.Document) -> list[PageKind]:
    """Kind of every page. Unrecognised pages count as maps/photos (skipped),
    except that an unrecognised first page is taken as the cover and an
    unrecognised last page as the summary."""
    kinds: list[PageKind] = []
    last = doc.page_count - 1
    for index, page in enumerate(doc.pages()):
        kind = classify_title(page_title(page))
        if kind is None:
            kind = (
                PageKind.COVER
                if index == 0
                else PageKind.SUMMARY
                if index == last
                else PageKind.MAPS
            )
        kinds.append(kind)
    return kinds
