"""Plain values printed in an electoral roll (Telangana S29 English format).

These models describe *what the roll says*: the synthetic generator writes them
as ground truth, and the parser's results are compared against them. The
parser's own output wraps each value with its raw OCR text and confidence.
"""

from datetime import date
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


def contract_config(
    *, frozen: bool = False, extra: Literal["allow", "ignore", "forbid"] = "ignore"
) -> ConfigDict:
    """JSON uses camelCase (the API is TypeScript); Python code uses snake_case.

    Both spellings are accepted when reading; camelCase is written.
    """
    return ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        frozen=frozen,
        extra=extra,
    )


class _Model(BaseModel):
    model_config = contract_config(frozen=True, extra="forbid")


class Gender(StrEnum):
    MALE = "male"
    FEMALE = "female"
    THIRD_GENDER = "third_gender"


class RelationType(StrEnum):
    FATHER = "father"
    MOTHER = "mother"
    HUSBAND = "husband"
    OTHER = "other"


class EntryMarker(StrEnum):
    """Printed on entries that aren't plain active electors."""

    DELETED = "deleted"
    MODIFIED = "modified"


class PageKind(StrEnum):
    COVER = "cover"
    MAPS = "maps"  # maps and building photos: classified, never extracted
    VOTERS = "voters"
    SUMMARY = "summary"


class Section(_Model):
    number: int
    name: str


class PollingStation(_Model):
    number: str  # "408", or "408A" for an auxiliary station
    name: str
    address: str


class ElectorCounts(_Model):
    male: int
    female: int
    third_gender: int
    total: int


class PrintedTotals(_Model):
    """Section 4 of the cover page: "Number of electors"."""

    start_serial: int
    end_serial: int
    counts: ElectorCounts


class SummaryRow(_Model):
    """One row of the summary page, e.g. the mother roll or a supplement."""

    roll_type: str
    counts: ElectorCounts


class RollHeader(_Model):
    """Everything on the cover page except the elector totals."""

    state_code: str  # "S29"
    state_name: str
    ac_number: int
    ac_name: str
    ac_reservation: str  # "GENERAL", "SC", "ST"
    pc_number: int
    pc_name: str
    pc_reservation: str  # "GEN", "SC", "ST"
    part_number: int
    revision_year: int
    revision_type: str
    qualifying_date: date
    publication_date: date
    roll_identification: str
    sections: list[Section]
    main_town: str
    post_office: str
    police_station: str
    mandal: str
    district: str
    pin_code: str
    polling_station: PollingStation
    station_type: str  # "General", "Male", "Female"
    auxiliary_station_count: int
    auxiliary_stations: list[PollingStation]


class VoterEntry(_Model):
    serial: int
    section_number: int
    page: int  # 1-based page number in the PDF
    box_index: int  # 0-29, row by row from the top left
    epic: str
    name: str
    relation_type: RelationType
    relative_name: str
    house_number: str
    age: int
    gender: Gender
    marker: EntryMarker | None = None


class RollTruth(_Model):
    """Ground truth for one synthetic roll PDF."""

    format: str = "telangana-s29-english"
    header: RollHeader
    printed_totals: PrintedTotals
    summary: list[SummaryRow]
    pages: list[PageKind]
    voters: list[VoterEntry]
