"""Thin wrapper around Tesseract (through pytesseract).

The Tesseract binary is found on PATH, or at ``TESSERACT_CMD`` when that
environment variable is set (useful on Windows, where the installer doesn't
add it to PATH).
"""

import os
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import pytesseract

GrayImage = npt.NDArray[np.uint8]


def configure() -> None:
    """Point pytesseract at ``TESSERACT_CMD`` when it's set."""
    cmd = os.environ.get("TESSERACT_CMD")
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd


def tesseract_version() -> str:
    configure()
    return str(pytesseract.get_tesseract_version())


def languages() -> list[str]:
    """Installed Tesseract language packs, e.g. ``["eng", "osd", "tel"]``."""
    configure()
    return sorted(str(lang) for lang in pytesseract.get_languages(config=""))


def read_line(image: GrayImage, *, lang: str = "eng", whitelist: str | None = None) -> str:
    """OCR an image holding a single line of text."""
    configure()
    config = "--psm 7"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    return str(pytesseract.image_to_string(image, lang=lang, config=config)).strip()


def read_block(image: GrayImage, *, lang: str = "eng") -> str:
    """OCR an image holding a block of text lines."""
    configure()
    return str(pytesseract.image_to_string(image, lang=lang, config="--psm 6"))


@dataclass(frozen=True)
class Word:
    text: str
    confidence: float  # 0-1
    start: int  # character offsets within the line's text
    end: int


@dataclass(frozen=True)
class Line:
    """One OCR'd line: words joined by single spaces, with their confidences."""

    text: str
    words: tuple[Word, ...]
    top: int  # pixel box, for reading order and joining pieces of a line
    bottom: int
    left: int

    def confidence(self, start: int, end: int) -> float:
        """Lowest word confidence over characters ``start:end`` (0 if none)."""
        inside = [w.confidence for w in self.words if w.start < end and w.end > start]
        return min(inside, default=0.0)


def _join(pieces: list[Line]) -> Line:
    """One line from pieces on the same baseline, left to right."""
    words: list[Word] = []
    offset = 0
    for piece in sorted(pieces, key=lambda p: p.left):
        for w in piece.words:
            words.append(Word(w.text, w.confidence, offset, offset + len(w.text)))
            offset += len(w.text) + 1
    return Line(
        " ".join(w.text for w in words),
        tuple(words),
        min(p.top for p in pieces),
        max(p.bottom for p in pieces),
        min(p.left for p in pieces),
    )


def read_lines(image: GrayImage, *, psm: int = 3, lang: str = "eng") -> list[Line]:
    """OCR a page region into lines, top to bottom, with word confidences.

    Tesseract sometimes splits one printed line into blocks (e.g. a label at
    the right margin); pieces whose vertical middles are within half a line
    height of each other are joined back together.
    """
    configure()
    data = pytesseract.image_to_data(
        image, lang=lang, config=f"--psm {psm}", output_type=pytesseract.Output.DICT
    )
    grouped: dict[tuple[int, int, int], list[int]] = {}
    for i, text in enumerate(data["text"]):
        if str(text).strip():
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            grouped.setdefault(key, []).append(i)

    pieces: list[Line] = []
    for indexes in grouped.values():
        words: list[Word] = []
        offset = 0
        for i in indexes:
            text = str(data["text"][i]).strip()
            conf = max(float(data["conf"][i]), 0.0) / 100
            words.append(Word(text, conf, offset, offset + len(text)))
            offset += len(text) + 1
        top = min(int(data["top"][i]) for i in indexes)
        bottom = max(int(data["top"][i]) + int(data["height"][i]) for i in indexes)
        left = min(int(data["left"][i]) for i in indexes)
        pieces.append(Line(" ".join(w.text for w in words), tuple(words), top, bottom, left))

    pieces.sort(key=lambda p: (p.top + p.bottom) / 2)
    rows: list[list[Line]] = []
    for piece in pieces:
        middle = (piece.top + piece.bottom) / 2
        if rows:
            last = rows[-1][0]
            if abs(middle - (last.top + last.bottom) / 2) < (last.bottom - last.top) / 2:
                rows[-1].append(piece)
                continue
        rows.append([piece])
    return [_join(row) for row in rows]
