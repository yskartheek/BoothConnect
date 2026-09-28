"""Extracted values: each keeps its raw OCR text and a confidence score."""

import re
from enum import StrEnum

from pydantic import BaseModel, field_validator

from roll_parser.model import contract_config


class Field[T](BaseModel):
    """One extracted value.

    ``value`` is ``None`` when the field wasn't found or couldn't be parsed;
    ``raw`` is the OCR text it came from (empty when not found).
    ``confidence`` is between 0 and 1: the lowest Tesseract word confidence
    within the value, or 0 when it's missing.
    """

    model_config = contract_config(frozen=True)

    value: T | None
    raw: str = ""
    confidence: float = 0.0

    @classmethod
    def missing(cls) -> "Field[T]":
        return cls(value=None)


class Severity(StrEnum):
    ERROR = "error"  # the file must be reviewed before anything goes live
    WARNING = "warning"  # worth a look, but doesn't block on its own


class Issue(BaseModel):
    """Something wrong or doubtful about the file. Never contains voter data."""

    model_config = contract_config(frozen=True)

    code: str  # stable identifier, e.g. "totals.sum_mismatch"
    severity: Severity
    message: str
    field: str | None = None  # dotted path in the JSON, e.g. "header.partNumber"
    page: int | None = None  # 1-based

    @field_validator("field")
    @classmethod
    def _camel_path(cls, path: str | None) -> str | None:
        """Paths follow the JSON's camelCase ("rows[3].relative_name" -> "rows[3].relativeName")."""
        return None if path is None else re.sub(r"_([a-z])", lambda m: m.group(1).upper(), path)
