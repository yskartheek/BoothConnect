"""Page geometry of the Telangana S29 English roll, in PDF points (A4).

Measured from the owner's sample (§4a of the design): voter boxes are about a
third of the page wide and a tenth of it high, 3 x 10 per page. The parser
doesn't use these numbers (it finds the boxes on the image); only the
generator and the tests do.
"""

import pymupdf

PAGE_WIDTH = 595.0
PAGE_HEIGHT = 842.0
RENDER_DPI = 240  # 1984 x 2807 px, like the sample's 1983 x 2806 JPEGs

MARGIN_X = 18.0
GRID_TOP = 62.0
COLUMNS = 3
ROWS = 10
BOXES_PER_PAGE = COLUMNS * ROWS
BOX_WIDTH = (PAGE_WIDTH - 2 * MARGIN_X) / COLUMNS
BOX_HEIGHT = 74.0

FONT = "helv"
FONT_BOLD = "hebo"
BODY_SIZE = 7.5
BODY_TOP = 23.0  # baseline of the first body line, from the box top
BODY_LINE = 9.5
BODY_LEFT = 0.03  # fractions of the box width
PHOTO_LEFT = 0.74
MAX_BODY_LINES = 5

LABEL_INDENT = 4.0  # continuation lines of a wrapped value start this far in


def box_rect(box_index: int) -> pymupdf.Rect:
    """Rectangle of voter box ``box_index`` (0-29, row by row) on its page."""
    row, col = divmod(box_index, COLUMNS)
    x0 = MARGIN_X + col * BOX_WIDTH
    y0 = GRID_TOP + row * BOX_HEIGHT
    return pymupdf.Rect(x0, y0, x0 + BOX_WIDTH, y0 + BOX_HEIGHT)


def body_width() -> float:
    """Width available to the text fields, left of the photo area."""
    return (PHOTO_LEFT - BODY_LEFT) * BOX_WIDTH - 3


def text_width(text: str, *, size: float = BODY_SIZE, bold: bool = False) -> float:
    return float(pymupdf.get_text_length(text, fontname=FONT_BOLD if bold else FONT, fontsize=size))


def wrap_field(label: str, value: str) -> list[str]:
    """Split ``"<label> : <value>"`` into lines that fit the body width.

    Words wrap onto continuation lines (drawn ``LABEL_INDENT`` further in). A
    word that doesn't fit on a line of its own is never split; the generator
    avoids those.
    """
    lines: list[str] = []
    current = f"{label} :"
    has_word = False
    for word in value.split():
        candidate = f"{current} {word}"
        indent = LABEL_INDENT if lines else 0.0
        if not has_word or text_width(candidate) + indent <= body_width():
            current, has_word = candidate, True
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines
