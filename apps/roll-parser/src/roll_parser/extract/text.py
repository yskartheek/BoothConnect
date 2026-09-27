"""Finding labelled values ("Label : value") in OCR'd lines, with confidence."""

import re
from collections.abc import Callable, Sequence
from datetime import date

from roll_parser.extract.fields import Field
from roll_parser.ocr import Line

# OCR sometimes reads ':' as ';', and '-' as an en dash
SEP = r"\s*[:;]\s*"
DASH = r"[-\u2013]"

# Letters Tesseract confuses with digits, inside a field that must be a number
_TO_DIGIT = str.maketrans({"O": "0", "o": "0", "D": "0", "I": "1", "l": "1", "|": "1", "S": "5"})


def to_int(raw: str) -> int | None:
    digits = raw.strip().translate(_TO_DIGIT)
    return int(digits) if digits.isdigit() else None


def to_date(raw: str) -> date | None:
    """``dd-mm-yyyy`` (also with ``/`` or ``.``), as printed in the rolls."""
    m = re.fullmatch(r"(\w{2})[-/.](\w{2})[-/.](\w{4})", raw.strip())
    if not m:
        return None
    day, month, year = (to_int(g) for g in m.groups())
    if day is None or month is None or year is None:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def span_field[T](line: Line, start: int, end: int, convert: Callable[[str], T | None]) -> Field[T]:
    raw = line.text[start:end].strip()
    return Field(
        value=convert(raw) if raw else None, raw=raw, confidence=line.confidence(start, end)
    )


def as_text(raw: str) -> str | None:
    return " ".join(raw.split()) or None


class LabelledValues:
    """Looks up ``Label : value`` pairs; a value ends at the next known label."""

    def __init__(self, lines: Sequence[Line], labels: Sequence[str]) -> None:
        self.lines = lines
        self.any_label = re.compile("|".join(f"(?:{label}){SEP}" for label in labels), re.I)

    def find[T](
        self,
        label: str,
        convert: Callable[[str], T | None],
        *,
        continuation: bool = False,
    ) -> tuple[Field[T], int | None]:
        """The value after ``label`` and the index of the line it's on.

        With ``continuation``, following lines that have no label of their
        own are appended (for addresses that wrap).
        """
        pattern = re.compile(f"(?:{label}){SEP}", re.I)
        for index, line in enumerate(self.lines):
            m = pattern.search(line.text)
            if not m:
                continue
            start = m.end()
            nxt = self.any_label.search(line.text, start)
            end = nxt.start() if nxt else len(line.text)
            field = span_field(line, start, end, convert)
            if continuation and not nxt:
                field = self._with_continuation(field, index, convert)
            return field, index
        return Field.missing(), None

    def _with_continuation[T](
        self, field: Field[T], index: int, convert: Callable[[str], T | None]
    ) -> Field[T]:
        raw, confidence = field.raw, field.confidence
        for line in self.lines[index + 1 :]:
            if self.any_label.search(line.text) or re.match(r"^\d+\.\s", line.text):
                break
            raw = f"{raw} {line.text}"
            confidence = min(confidence, line.confidence(0, len(line.text)))
        return Field(value=convert(raw), raw=raw, confidence=confidence)


def first_line_index(lines: Sequence[Line], pattern: str, start: int = 0) -> int | None:
    regex = re.compile(pattern, re.I)
    for index in range(start, len(lines)):
        if regex.search(lines[index].text):
            return index
    return None
