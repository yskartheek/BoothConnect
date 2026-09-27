"""Voter pages: find the 3 x 10 grid of boxes and read each box.

Productionised from the spike (``docs/design/spikes/roll_ocr_spike.py``), with
one change for speed: each page is OCR'd **once** (sparse-text mode, after
removing the box borders) and the words are assigned to boxes by position,
instead of running Tesseract three times per box.

Within a box (fractions of its width/height, from the Telangana S29 layout):

- top strip (``y < TOP``): the serial number (left) and the EPIC (right)
- right column (``x > PHOTO``, below the top strip): the photo placeholder;
  only its text is used, to spot DELETED / MODIFIED markers. There is no
  photo in the published rolls, and nothing from this area is stored except
  the marker.
- everything else: Name, relation, House Number, Age, Gender
"""

import re
from dataclasses import dataclass

import cv2

from roll_parser.extract.fields import Field
from roll_parser.extract.text import DASH, to_int
from roll_parser.model import EntryMarker, Gender, RelationType
from roll_parser.ocr import GrayImage, Line, PageWord, line_from_words

TOP = 0.21
PHOTO = 0.73
SERIAL_LEFT = 0.0
SERIAL_RIGHT = 0.45

# Voter boxes are about a third of the page wide and a tenth high
BOX_WIDTH = (0.28, 0.36)
BOX_HEIGHT = (0.07, 0.11)


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int

    def contains(self, word: PageWord) -> bool:
        return self.x <= word.cx < self.x + self.w and self.y <= word.cy < self.y + self.h


def find_boxes(image: GrayImage) -> list[Box]:
    """Voter boxes on a page, in reading order (row by row, left to right)."""
    h, w = image.shape
    ink = cv2.adaptiveThreshold(
        image, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 10
    )
    contours, _ = cv2.findContours(ink, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        x, y, bw, bh = cv2.boundingRect(contour)
        if BOX_WIDTH[0] * w < bw < BOX_WIDTH[1] * w and BOX_HEIGHT[0] * h < bh < BOX_HEIGHT[1] * h:
            candidates.append(Box(x, y, bw, bh))

    # The inner and outer edge of a border are both found: keep one of each
    tolerance = 0.01 * w
    boxes: list[Box] = []
    for box in sorted(candidates, key=lambda b: (b.y, b.x)):
        if not any(abs(box.x - b.x) < tolerance and abs(box.y - b.y) < tolerance for b in boxes):
            boxes.append(box)

    # Reading order: group into rows by vertical position, then left to right
    rows: list[list[Box]] = []
    for box in sorted(boxes, key=lambda b: b.y):
        if rows and abs(box.y - rows[-1][0].y) < box.h / 2:
            rows[-1].append(box)
        else:
            rows.append([box])
    return [box for row in rows for box in sorted(row, key=lambda b: b.x)]


def top_strip(image: GrayImage, box: Box, left: float, right: float) -> GrayImage:
    """The part of a box's top strip between two fractions of its width."""
    inset = 3
    return image[
        box.y + inset : box.y + int(TOP * box.h),
        box.x + max(int(left * box.w), inset) : box.x + int(right * box.w) - inset,
    ]


def remove_box_lines(crop: GrayImage) -> GrayImage:
    """White out the small serial-number box's own borders, which are too
    short for :func:`remove_rules`. Digits are much shorter than the box."""
    h, w = crop.shape
    if h < 4 or w < 4:
        return crop
    ink = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    vertical = cv2.morphologyEx(
        ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(int(h * 0.55), 2)))
    )
    horizontal = cv2.morphologyEx(
        ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(int(w * 0.3), 2), 1))
    )
    mask = cv2.dilate(
        cv2.bitwise_or(vertical, horizontal), cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    )
    out = crop.copy()
    out[mask > 0] = 255
    return out


def _reading_order(words: list[PageWord]) -> list[PageWord]:
    """Words grouped into lines by vertical position, each line left to right."""
    lines: list[list[PageWord]] = []
    for word in sorted(words, key=lambda w: w.cy):
        if lines and abs(word.cy - lines[-1][0].cy) < max(word.height, lines[-1][0].height) / 2:
            lines[-1].append(word)
        else:
            lines.append([word])
    return [w for line in lines for w in sorted(line, key=lambda w: w.left)]


def _strip_rules(words: list[PageWord]) -> list[PageWord]:
    """Drop the stray bars and dashes left by the small serial-number box."""
    return [w for w in words if not re.fullmatch(r"[|\[\]_—\-=.,'\"]+", w.text)]


@dataclass(frozen=True)
class BoxText:
    """OCR'd text of one box, split by area."""

    serial: Line
    epic: Line
    body: Line
    photo: Line

    @property
    def raw_text(self) -> str:
        return "\n".join(t for t in (self.serial.text, self.epic.text, self.body.text) if t)


def split_box(box: Box, words: list[PageWord]) -> BoxText:
    inside = _strip_rules([w for w in words if box.contains(w)])
    serial: list[PageWord] = []
    epic: list[PageWord] = []
    body: list[PageWord] = []
    photo: list[PageWord] = []
    for w in inside:
        fx = (w.cx - box.x) / box.w
        fy = (w.cy - box.y) / box.h
        if fy < TOP:
            (serial if fx < SERIAL_RIGHT else epic).append(w)
        elif fx > PHOTO:
            photo.append(w)
        else:
            body.append(w)
    return BoxText(
        line_from_words(_reading_order(serial)),
        line_from_words(_reading_order(epic)),
        line_from_words(_reading_order(body)),
        line_from_words(_reading_order(photo)),
    )


# --- EPIC -------------------------------------------------------------------

TO_LETTER = str.maketrans(
    {"1": "I", "0": "O", "5": "S", "8": "B", "2": "Z", "6": "G", "|": "I", "4": "A", "7": "T"}
)
TO_DIGIT = str.maketrans(
    {
        "O": "0",
        "I": "1",
        "L": "1",
        "S": "5",
        "B": "8",
        "Z": "2",
        "G": "6",
        "Q": "0",
        "D": "0",
        "T": "7",
        "A": "4",
    }
)


def epic_chars(raw: str) -> str:
    return re.sub(r"[^A-Z0-9|]", "", raw.upper())


def normalise_epic(raw: str) -> str | None:
    """3 letters + 7 digits, correcting letter/digit confusions by position.

    Substitutions are unambiguous (a letter position can't hold a digit), but
    if characters had to be dropped to find 10, the caller should flag it.
    """
    text = epic_chars(raw)
    for i in range(len(text) - 9):
        candidate = text[i : i + 3].translate(TO_LETTER) + text[i + 3 : i + 10].translate(TO_DIGIT)
        if re.fullmatch(r"[A-Z]{3}\d{7}", candidate):
            return candidate
    return None


# --- names --------------------------------------------------------------------

_NAME_FIXES = str.maketrans(
    {"]": "I", "[": "I", "|": "I", "!": "I", "0": "O", "1": "I", "5": "S", "8": "B", "$": "S"}
)


def clean_name(raw: str) -> str | None:
    """Uppercase letters, spaces, dots, apostrophes and hyphens only.

    Common misreads are fixed (``]`` → ``I``, digits that look like letters);
    anything else that isn't part of a name is dropped. The raw text is always
    kept next to the cleaned value.
    """
    # Names are printed in capitals, so a lowercase l is a misread I
    text = raw.replace("l", "I").upper().translate(_NAME_FIXES)
    text = re.sub(r"[^A-Z .'\-]", "", text)
    text = re.sub(r"\s+", " ", text).strip(" .'-")
    return text or None


def clean_house_number(raw: str) -> str | None:
    text = re.sub(r"\s+", "", raw).strip(".,;:_")
    return text or None


def parse_age(raw: str) -> int | None:
    return to_int(re.sub(r"[^\w]", "", raw))


def parse_gender(raw: str) -> Gender | None:
    text = raw.strip().lower()
    if text.startswith("m"):
        return Gender.MALE
    if text.startswith("f"):
        return Gender.FEMALE
    if text.startswith(("t", "3")):
        return Gender.THIRD_GENDER
    return None


RELATION_WORDS = {
    "father": RelationType.FATHER,
    "mother": RelationType.MOTHER,
    "husband": RelationType.HUSBAND,
    "wife": RelationType.OTHER,
    "guardian": RelationType.OTHER,
    "other": RelationType.OTHER,
}


def parse_marker(photo: Line) -> EntryMarker | None:
    text = photo.text.upper()
    if "DELET" in text:
        return EntryMarker.DELETED
    if "MODIF" in text:
        return EntryMarker.MODIFIED
    return None


# --- body fields ------------------------------------------------------------

# The colon after a label is often misread or dropped
LABEL_END = r"\s*[:;=+]*\s*"
NAME_LABEL = re.compile(rf"^\W{{0,3}}Name{LABEL_END}", re.I)
RELATION_LABEL = re.compile(
    rf"\b(?P<word>Father|Mother|Husband|Wife|Other|Guardian)'?s?\s*(?:Name)?{LABEL_END}", re.I
)
HOUSE_LABEL = re.compile(rf"\bHouse\s*(?:Number|No\.?){LABEL_END}", re.I)
AGE_LABEL = re.compile(rf"\bAge{LABEL_END}", re.I)
GENDER_LABEL = re.compile(rf"\bGender{LABEL_END}", re.I)


@dataclass(frozen=True)
class BodyFields:
    name: Field[str]
    relation_type: Field[RelationType]
    relative_name: Field[str]
    house_number: Field[str]
    age: Field[int]
    gender: Field[Gender]


def _field[T](line: Line, start: int, end: int, value: T | None) -> Field[T]:
    raw = line.text[start:end].strip()
    if not raw:
        return Field(value=None)
    return Field(value=value, raw=raw, confidence=line.confidence(start, end))


def parse_body(body: Line) -> BodyFields:
    """Split the body text at its labels. A missing label leaves its field
    empty (and the field before it runs on to the next label found)."""
    text = body.text
    found: list[tuple[str, re.Match[str]]] = []
    position = 0
    for key, pattern in [
        ("name", NAME_LABEL),
        ("relation", RELATION_LABEL),
        ("house", HOUSE_LABEL),
        ("age", AGE_LABEL),
        ("gender", GENDER_LABEL),
    ]:
        m = pattern.search(text, position)
        if m:
            found.append((key, m))
            position = m.end()

    spans: dict[str, tuple[int, int]] = {}
    labels: dict[str, re.Match[str]] = {}
    for i, (key, m) in enumerate(found):
        end = found[i + 1][1].start() if i + 1 < len(found) else len(text)
        spans[key] = (m.end(), end)
        labels[key] = m

    name = relative = house = Field[str](value=None)
    relation = Field[RelationType](value=None)
    age = Field[int](value=None)
    gender = Field[Gender](value=None)

    if span := spans.get("name"):
        raw = text[span[0] : span[1]]
        name = _field(body, *span, clean_name(raw))
    if span := spans.get("relation"):
        m = labels["relation"]
        relation = Field(
            value=RELATION_WORDS[m.group("word").lower()],
            raw=m.group(0).strip(),
            confidence=body.confidence(m.start(), m.end()),
        )
        relative = _field(body, *span, clean_name(text[span[0] : span[1]]))
    if span := spans.get("house"):
        house = _field(body, *span, clean_house_number(text[span[0] : span[1]]))
    if span := spans.get("age"):
        age = _field(body, *span, parse_age(text[span[0] : span[1]]))
    if span := spans.get("gender"):
        gender = _field(body, *span, parse_gender(text[span[0] : span[1]]))
    return BodyFields(name, relation, relative, house, age, gender)


def page_section(header_words: list[PageWord]) -> tuple[int | None, float]:
    """Section number from the page header ("Section No and Name : 1-...")."""
    line = line_from_words(_reading_order(header_words))
    m = re.search(rf"Section\s*No\.?\s*and\s*Name\s*[:;]?\s*(\w{{1,3}})\s*{DASH}", line.text, re.I)
    if not m:
        return None, 0.0
    return to_int(m.group(1)), line.confidence(m.start(1), m.end(1))
