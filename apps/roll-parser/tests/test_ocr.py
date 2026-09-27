"""Smoke tests: the OCR toolchain (PyMuPDF → NumPy → Tesseract) works end to end."""

import numpy as np
import pymupdf
import pytest

from roll_parser import ocr
from roll_parser.cli import main


def render_text(text: str) -> ocr.GrayImage:
    """Draw ``text`` on a blank PDF page and render it to a grayscale image."""
    doc = pymupdf.open()
    page = doc.new_page(width=400, height=60)
    page.insert_text((10, 40), text, fontsize=24, fontname="helv")
    pix = page.get_pixmap(matrix=pymupdf.Matrix(3, 3), colorspace=pymupdf.csGRAY)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w)


def test_tesseract_is_installed_with_english() -> None:
    assert ocr.tesseract_version().startswith("5.")
    assert "eng" in ocr.languages()


def test_reads_rendered_text() -> None:
    # Letters that Tesseract can confuse with digits (I/1, O/0) are avoided here;
    # EPIC correction by position handles those in the parser.
    assert ocr.read_line(render_text("BOOTHCONNECT 2026")) == "BOOTHCONNECT 2026"


def test_whitelist_limits_characters() -> None:
    assert ocr.read_line(render_text("Age : 42"), whitelist="0123456789") == "42"


def test_check_command_passes(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["check"]) == 0
    assert "tesseract" in capsys.readouterr().out
