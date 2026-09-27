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


@dataclass(frozen=True)
class PageWord:
    """A word found anywhere on a page, with its pixel box."""

    text: str
    confidence: float  # 0-1
    left: int
    top: int
    width: int
    height: int

    @property
    def cx(self) -> float:
        return self.left + self.width / 2

    @property
    def cy(self) -> float:
        return self.top + self.height / 2


# Names and ID numbers aren't dictionary words: without this, Tesseract
# "corrects" them towards English (e.g. SAI -> SAL).
NO_DICTIONARY = "-c load_system_dawg=0 -c load_freq_dawg=0"


def read_words(
    image: GrayImage,
    *,
    psm: int = 11,
    lang: str = "eng",
    dictionary: bool = True,
    whitelist: str | None = None,
) -> list[PageWord]:
    """Every word on the image with its position (sparse text mode by default,
    which finds text in grids of boxes better than page layout analysis)."""
    configure()
    config = f"--psm {psm}" if dictionary else f"--psm {psm} {NO_DICTIONARY}"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    data = pytesseract.image_to_data(
        image, lang=lang, config=config, output_type=pytesseract.Output.DICT
    )
    return [
        PageWord(
            str(text).strip(),
            max(float(data["conf"][i]), 0.0) / 100,
            int(data["left"][i]),
            int(data["top"][i]),
            int(data["width"][i]),
            int(data["height"][i]),
        )
        for i, text in enumerate(data["text"])
        if str(text).strip()
    ]


def line_from_words(words: list[PageWord]) -> Line:
    """Join words (already in reading order) into one Line."""
    joined: list[Word] = []
    offset = 0
    for w in words:
        joined.append(Word(w.text, w.confidence, offset, offset + len(w.text)))
        offset += len(w.text) + 1
    if not words:
        return Line("", (), 0, 0, 0)
    return Line(
        " ".join(w.text for w in words),
        tuple(joined),
        min(w.top for w in words),
        max(w.top + w.height for w in words),
        min(w.left for w in words),
    )


def read_words_scaled(
    image: GrayImage, scale: float, *, psm: int = 11, dictionary: bool = True
) -> list[PageWord]:
    """:func:`read_words` on an enlarged copy; positions are in the original's pixels."""
    if scale == 1:
        return read_words(image, psm=psm, dictionary=dictionary)
    import cv2

    big = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return [
        PageWord(
            w.text,
            w.confidence,
            round(w.left / scale),
            round(w.top / scale),
            round(w.width / scale),
            round(w.height / scale),
        )
        for w in read_words(big.astype(np.uint8), psm=psm, dictionary=dictionary)
    ]


STRIP_PAD = 12


def read_strips(crops: list[GrayImage], *, whitelist: str, lang: str = "eng") -> list[Line]:
    """OCR many small one-line crops with a single Tesseract call.

    The crops are stacked vertically (with white space between) and read as a
    block; each word is then given back to the crop it lies in. Returns one
    Line per crop (empty when nothing was read).
    """
    import cv2

    if not crops:
        return []
    width = max(c.shape[1] for c in crops) + 2 * STRIP_PAD
    padded = []
    bounds = []
    y = 0
    for crop in crops:
        piece = cv2.copyMakeBorder(
            crop,
            STRIP_PAD,
            STRIP_PAD,
            STRIP_PAD,
            width - crop.shape[1] - STRIP_PAD,
            cv2.BORDER_CONSTANT,
            value=255,
        )
        padded.append(piece)
        bounds.append((y, y + piece.shape[0]))
        y += piece.shape[0]
    stack: GrayImage = np.vstack(padded).astype(np.uint8)
    words = read_words(stack, psm=6, lang=lang, dictionary=False, whitelist=whitelist)
    per_crop: list[list[PageWord]] = [[] for _ in crops]
    for word in words:
        for i, (top, bottom) in enumerate(bounds):
            if top <= word.cy < bottom:
                per_crop[i].append(word)
                break
    return [line_from_words(sorted(ws, key=lambda w: w.left)) for ws in per_crop]
