"""Finding labelled values ("Label : value") in OCR'd lines, with confidence."""

import re
from collections.abc import Callable, Sequence
from datetime import date

from roll_parser.extract.fields import Field
from roll_parser.ocr import Line

# OCR sometimes reads ':' as ';' or '>', and '-' as an en dash
SEP = r"\s*[:;>]\s*"
# For labels printed in a table column, without a colon
OPT_SEP = r"\s*[:;>]?\s*"
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
    """Looks up ``Label : value`` pairs; a value ends at the next known label.

    Each label is a regular expression that includes its separator (``SEP``
    or ``OPT_SEP``), so ``Mandal :`` is a label but ``Mandal Parishad`` isn't.
    """

    def __init__(self, lines: Sequence[Line], labels: Sequence[str]) -> None:
        self.lines = lines
        self.any_label = re.compile("|".join(f"(?:{label})" for label in labels), re.I)

    def before_label(self, index: int) -> tuple[int, bool]:
        """Where line ``index``'s own text ends, and whether a label follows."""
        line = self.lines[index]
        m = self.any_label.search(line.text)
        return (m.start(), True) if m else (len(line.text), False)

    def find[T](
        self,
        label: str,
        convert: Callable[[str], T | None],
        *,
        continuation: bool = False,
        below: bool = False,
        stop: str | None = None,
    ) -> tuple[Field[T], int | None]:
        """The value after ``label`` and the index of the line it's on.

        With ``below``, a label with nothing after it takes its value from the
        next line (tables where the value sits under the label). With
        ``continuation``, following lines that have no label of their own are
        appended (for values that wrap), up to a numbered heading or a line
        matching ``stop``.
        """
        pattern = re.compile(label, re.I)
        for index, line in enumerate(self.lines):
            m = pattern.search(line.text)
            if not m:
                continue
            start = m.end()
            nxt = self.any_label.search(line.text, start)
            end = nxt.start() if nxt else len(line.text)
            field = span_field(line, start, end, convert)
            labelled = nxt is not None
            if not field.raw and below and index + 1 < len(self.lines):
                index += 1
                end, labelled = self.before_label(index)
                field = span_field(self.lines[index], 0, end, convert)
            if continuation and field.raw and not labelled:
                field = self._with_continuation(field, index, convert, stop)
            return field, index
        return Field.missing(), None

    def _with_continuation[T](
        self, field: Field[T], index: int, convert: Callable[[str], T | None], stop: str | None
    ) -> Field[T]:
        raw, confidence = field.raw, field.confidence
        for line in self.lines[index + 1 :]:
            if (
                self.any_label.search(line.text)
                or re.match(r"^\d+\.\s", line.text)
                or (stop and re.search(stop, line.text, re.I))
            ):
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
