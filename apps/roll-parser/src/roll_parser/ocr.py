"""Thin wrapper around Tesseract (through pytesseract).

The Tesseract binary is found on PATH, or at ``TESSERACT_CMD`` when that
environment variable is set (useful on Windows, where the installer doesn't
add it to PATH).
"""

import os

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
