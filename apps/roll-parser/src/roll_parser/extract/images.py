"""Turning PDF pages into images for OCR."""

import cv2
import numpy as np
import pymupdf

from roll_parser.ocr import GrayImage

FALLBACK_DPI = 300


def page_dpi(page: pymupdf.Page) -> float:
    """Resolution at which the page's own image is drawn 1:1.

    Published rolls are one JPEG per page, so rendering at the image's own
    resolution avoids resampling it. Pages without an image get 300 DPI.
    """
    images = page.get_images()
    if len(images) != 1:
        return FALLBACK_DPI
    width_px = images[0][2]
    return max(float(width_px) / float(page.rect.width) * 72, 150.0)


def render(
    page: pymupdf.Page, *, dpi: float | None = None, clip: pymupdf.Rect | None = None
) -> GrayImage:
    pix = page.get_pixmap(dpi=round(dpi or page_dpi(page)), colorspace=pymupdf.csGRAY, clip=clip)
    image: GrayImage = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w).copy()
    return image


def remove_rules(image: GrayImage) -> GrayImage:
    """White out long horizontal and vertical lines (table borders, boxes).

    Tesseract skips text that touches table borders; without them it reads
    the cells as plain lines of text.
    """
    h, w = image.shape
    ink = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    horizontal = cv2.morphologyEx(
        ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(w // 40, 10), 1))
    )
    vertical = cv2.morphologyEx(
        ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(h // 60, 10)))
    )
    mask = cv2.dilate(cv2.bitwise_or(horizontal, vertical), np.ones((3, 3), np.uint8))
    out = image.copy()
    out[mask > 0] = 255
    return out
