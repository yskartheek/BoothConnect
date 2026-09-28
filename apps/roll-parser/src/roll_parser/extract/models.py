"""What the parser extracts from the cover and summary pages.

Each value is a :class:`Field` (value, raw OCR text, confidence). ``values()``
drops the wrappers so a result can be compared with ground truth.
"""

from datetime import date

from pydantic import BaseModel

from roll_parser.extract.fields import Field, Issue
from roll_parser.model import (
    ElectorCounts,
    PageKind,
    PollingStation,
    PrintedTotals,
    RollHeader,
    Section,
    SummaryRow,
    contract_config,
)


class _Model(BaseModel):
    model_config = contract_config(frozen=True)


class MissingValueError(ValueError):
    """``values()`` was called on a result with a missing field."""


def _v[T](field: Field[T], name: str) -> T:
    if field.value is None:
        raise MissingValueError(name)
    return field.value


class ExtractedSection(_Model):
    number: Field[int]
    name: Field[str]

    def values(self) -> Section:
        return Section(number=_v(self.number, "number"), name=_v(self.name, "name"))


class ExtractedStation(_Model):
    number: Field[str]
    name: Field[str]
    address: Field[str]

    def values(self) -> PollingStation:
        return PollingStation(
            number=_v(self.number, "number"),
            name=_v(self.name, "name"),
            address=_v(self.address, "address"),
        )


OPTIONAL_HEADER_FIELDS = frozenset({"subdivision"})


class ExtractedHeader(_Model):
    state_code: Field[str]
    state_name: Field[str]
    ac_number: Field[int]
    ac_name: Field[str]
    ac_reservation: Field[str]
    pc_number: Field[int]
    pc_name: Field[str]
    pc_reservation: Field[str]
    part_number: Field[int]
    revision_year: Field[int]
    revision_type: Field[str]
    qualifying_date: Field[date]
    publication_date: Field[date]
    roll_identification: Field[str]
    sections: list[ExtractedSection]
    main_town: Field[str]
    post_office: Field[str]
    police_station: Field[str]
    mandal: Field[str]
    subdivision: Field[str]  # not on every cover; missing isn't an error
    district: Field[str]
    pin_code: Field[str]
    polling_station: ExtractedStation
    station_type: Field[str]
    auxiliary_station_count: Field[int]
    auxiliary_stations: list[ExtractedStation]

    def scalar_fields(self) -> dict[str, Field[object]]:
        """Every top-level Field, by name (sections and stations excluded)."""
        return {
            name: value
            for name in type(self).model_fields
            if isinstance(value := getattr(self, name), Field)
        }

    def values(self) -> RollHeader:
        data: dict[str, object] = {
            name: field.value if name in OPTIONAL_HEADER_FIELDS else _v(field, name)
            for name, field in self.scalar_fields().items()
        }
        data["sections"] = [s.values() for s in self.sections]
        data["polling_station"] = self.polling_station.values()
        data["auxiliary_stations"] = [s.values() for s in self.auxiliary_stations]
        return RollHeader.model_validate(data)


class ExtractedCounts(_Model):
    male: Field[int]
    female: Field[int]
    third_gender: Field[int]
    total: Field[int]

    def values(self) -> ElectorCounts:
        return ElectorCounts(
            male=_v(self.male, "male"),
            female=_v(self.female, "female"),
            third_gender=_v(self.third_gender, "third_gender"),
            total=_v(self.total, "total"),
        )


class ExtractedTotals(_Model):
    start_serial: Field[int]
    end_serial: Field[int]
    counts: ExtractedCounts

    def values(self) -> PrintedTotals:
        return PrintedTotals(
            start_serial=_v(self.start_serial, "start_serial"),
            end_serial=_v(self.end_serial, "end_serial"),
            counts=self.counts.values(),
        )


class ExtractedSummaryRow(_Model):
    roll_type: Field[str]
    counts: ExtractedCounts

    def values(self) -> SummaryRow:
        return SummaryRow(roll_type=_v(self.roll_type, "roll_type"), counts=self.counts.values())


class ExtractedSummary(_Model):
    rows: list[ExtractedSummaryRow]  # one per roll type (mother roll, supplements)
    total: ExtractedCounts | None  # the printed "Total" row


class HeaderExtraction(_Model):
    """Everything outside the voter boxes: page kinds, cover and summary."""

    pages: list[PageKind]
    header: ExtractedHeader | None  # None when there's no cover page
    printed_totals: ExtractedTotals | None
    summary: ExtractedSummary | None
    issues: list[Issue]

    @property
    def needs_review(self) -> bool:
        return any(issue.severity == "error" for issue in self.issues)
