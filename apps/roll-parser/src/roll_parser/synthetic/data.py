"""Fake roll content from a fixed seed. No real person's data is used.

Given names come from a short list of common first names; family names and
place names are made up from syllables, so they don't belong to anyone.
"""

import random
import string
from collections import Counter
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict

from roll_parser.model import (
    ElectorCounts,
    EntryMarker,
    Gender,
    PageKind,
    PollingStation,
    PrintedTotals,
    RelationType,
    RollHeader,
    RollTruth,
    Section,
    SummaryRow,
    VoterEntry,
)
from roll_parser.synthetic import layout

MALE_NAMES = [
    "RAVI", "SURESH", "RAMESH", "MAHESH", "SRINIVAS", "VENKATESH", "KRISHNA", "RAJU",
    "NARESH", "PRAKASH", "ANIL", "SUNIL", "KIRAN", "VIJAY", "ARJUN", "GOPAL",
    "MOHAN", "SATISH", "RAJESH", "PRAVEEN", "SANTOSH", "NAGESH", "HARI", "BALU",
]  # fmt: skip
FEMALE_NAMES = [
    "LAKSHMI", "SARITHA", "PADMA", "SUJATHA", "RADHA", "KAVITHA", "SWAPNA", "ANITHA",
    "LATHA", "RANI", "MANJULA", "SUNITHA", "JYOTHI", "RENUKA", "SHOBHA", "VANI",
    "GEETHA", "SWATHI", "DIVYA", "MADHAVI", "PUSHPA", "SAROJA", "USHA", "KALPANA",
]  # fmt: skip
MIDDLE_NAMES = ["VENKATA", "SAI", "NAGA", "SRI", "SATYA", "RAMA", "SIVA", "DURGA"]
LONG_NAMES = ["SATYANARAYANA", "VENKATESWARLU", "RAJYALAKSHMI", "SUBRAHMANYAM"]

SYLLABLES = [
    "KO", "RA", "PA", "TI", "MA", "LA", "NE", "NI", "VA", "DA", "BO", "GU",
    "SA", "YA", "CHE", "RU", "DDI", "LLA", "KA", "NA", "PU", "TA", "GA", "ME",
]  # fmt: skip
PLACE_SUFFIXES = ["NAGAR", "COLONY", "PALLY", "GUDA", "PET", "BASTI", "THANDA"]

RELATION_LABELS = {
    RelationType.FATHER: "Fathers Name",
    RelationType.MOTHER: "Mothers Name",
    RelationType.HUSBAND: "Husbands Name",
    RelationType.OTHER: "Others Name",
}
GENDER_LABELS = {
    Gender.MALE: "Male",
    Gender.FEMALE: "Female",
    Gender.THIRD_GENDER: "Third Gender",
}

# Prefix letters that Tesseract tends to misread as digits, so the parser's
# letter/digit correction gets exercised.
CONFUSABLE_LETTERS = "IOSZBG"


class RollSpec(BaseModel):
    """What to generate. Every choice is derived from ``seed``."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    seed: int = 1
    section_sizes: list[int] = [30, 20]  # voters per section, in order
    auxiliary_stations: int = 0
    deleted: int = 0  # entries marked DELETED (not counted in the totals)
    modified: int = 0  # entries marked MODIFIED
    third_gender: int = 0
    long_name_share: float = 0.1  # share of names long enough to wrap
    rare_epic_prefixes: int = 1  # prefixes used by only one entry
    ac_number: int = 40
    ac_name: str = "PATANCHERU"
    ac_reservation: str = "GENERAL"
    pc_number: int = 6
    pc_name: str = "MEDAK"
    pc_reservation: str = "GEN"
    part_number: int = 408
    box_style: Literal["plain", "framed"] = "plain"  # see render.BoxStyle


def _made_up_word(rng: random.Random, syllables: int) -> str:
    return "".join(rng.choice(SYLLABLES) for _ in range(syllables))


def _family_name(rng: random.Random) -> str:
    return _made_up_word(rng, rng.randint(2, 4))


def _person_name(rng: random.Random, gender: Gender, *, long: bool) -> str:
    pool = FEMALE_NAMES if gender is Gender.FEMALE else MALE_NAMES
    if gender is Gender.THIRD_GENDER:
        pool = MALE_NAMES + FEMALE_NAMES
    parts = [rng.choice(pool)]
    if long:
        parts = [rng.choice(MIDDLE_NAMES), rng.choice(LONG_NAMES), *parts]
    elif rng.random() < 0.3:
        parts.insert(0, rng.choice(MIDDLE_NAMES))
    return " ".join([*parts, _family_name(rng)])


def _place_name(rng: random.Random) -> str:
    return f"{_made_up_word(rng, rng.randint(2, 3))} {rng.choice(PLACE_SUFFIXES)}"


def _epic_prefixes(rng: random.Random, spec: RollSpec) -> tuple[str, list[str], list[str]]:
    """Main prefix, a few common alternatives, and rare one-off prefixes."""

    def prefix(confusable: bool) -> str:
        letters = CONFUSABLE_LETTERS if confusable else string.ascii_uppercase
        return rng.choice(string.ascii_uppercase) + rng.choice(letters) + rng.choice(letters)

    main = prefix(True)
    common = [prefix(False) for _ in range(2)]
    rare = [prefix(False) for _ in range(spec.rare_epic_prefixes)]
    return main, common, rare


def _lines(label: str, value: str) -> int:
    return len(layout.wrap_field(label, value))


def generate(spec: RollSpec) -> RollTruth:
    """Build the ground truth for a synthetic roll."""
    rng = random.Random(spec.seed)
    total = sum(spec.section_sizes)

    sections = [
        Section(number=i + 1, name=f"{_made_up_word(rng, 2)} {rng.choice(PLACE_SUFFIXES)}")
        for i in range(len(spec.section_sizes))
    ]
    main_prefix, common_prefixes, rare_prefixes = _epic_prefixes(rng, spec)

    # Which serials get special treatment
    serials = list(range(1, total + 1))
    special = rng.sample(serials, spec.deleted + spec.modified + spec.third_gender)
    deleted = set(special[: spec.deleted])
    modified = set(special[spec.deleted : spec.deleted + spec.modified])
    third = set(special[spec.deleted + spec.modified :])
    rare_serials = dict(zip(rng.sample(serials, len(rare_prefixes)), rare_prefixes, strict=True))

    voters: list[VoterEntry] = []
    used_epics: set[str] = set()
    page = 3  # 1: cover, 2: maps
    serial = 0
    household = rng.randint(1, 9)
    for section, size in zip(sections, spec.section_sizes, strict=True):
        for i in range(size):
            serial += 1
            box = i % layout.BOXES_PER_PAGE
            if i and box == 0:
                page += 1

            if serial in third:
                gender = Gender.THIRD_GENDER
            else:
                gender = Gender.MALE if rng.random() < 0.5 else Gender.FEMALE

            relation = rng.choices(
                list(RelationType),
                weights=[60, 10, 28 if gender is Gender.FEMALE else 0, 2],
            )[0]
            if serial <= 4:  # make sure every relation type appears
                relation = list(RelationType)[serial - 1]
                if relation is RelationType.HUSBAND and gender is Gender.MALE:
                    gender = Gender.FEMALE
            relative_gender = {
                RelationType.FATHER: Gender.MALE,
                RelationType.HUSBAND: Gender.MALE,
                RelationType.MOTHER: Gender.FEMALE,
                RelationType.OTHER: rng.choice([Gender.MALE, Gender.FEMALE]),
            }[relation]

            # At most one of the two names wraps, so the box never overflows
            # Name and relative's name get 3 lines between them (house number
            # and age/gender take the other 2), so at most one of them wraps.
            long_name = rng.random() < spec.long_name_share
            label = RELATION_LABELS[relation]
            name = _person_name(rng, gender, long=long_name)
            while _lines("Name", name) > 2:
                name = _person_name(rng, gender, long=long_name)
            relative = _person_name(rng, relative_gender, long=False)
            while _lines("Name", name) + _lines(label, relative) > layout.MAX_BODY_LINES - 2:
                relative = _person_name(rng, relative_gender, long=False)

            if rng.random() < 0.35:
                household = rng.randint(household, household + 3)
            house = f"{rng.randint(1, 12)}-{household}"
            if rng.random() < 0.25:
                house += "/" + rng.choice(["A", "B", "1", "2", "1/A"])

            prefix = rare_serials.get(serial) or (
                rng.choice(common_prefixes) if rng.random() < 0.08 else main_prefix
            )
            epic = f"{prefix}{rng.randint(0, 9_999_999):07d}"
            while epic in used_epics:
                epic = f"{prefix}{rng.randint(0, 9_999_999):07d}"
            used_epics.add(epic)

            marker = None
            if serial in deleted:
                marker = EntryMarker.DELETED
            elif serial in modified:
                marker = EntryMarker.MODIFIED

            voters.append(
                VoterEntry(
                    serial=serial,
                    section_number=section.number,
                    page=page,
                    box_index=box,
                    epic=epic,
                    name=name,
                    relation_type=relation,
                    relative_name=relative,
                    house_number=house,
                    age=int(rng.triangular(18, 100, 32)),
                    gender=gender,
                    marker=marker,
                )
            )
        page += 1

    active = [v for v in voters if v.marker is not EntryMarker.DELETED]
    by_gender = Counter(v.gender for v in active)
    counts = ElectorCounts(
        male=by_gender[Gender.MALE],
        female=by_gender[Gender.FEMALE],
        third_gender=by_gender[Gender.THIRD_GENDER],
        total=len(active),
    )

    town = _place_name(rng)
    station_name = f"Mandal Parishad Primary School, {_place_name(rng)}, {town}"
    header = RollHeader(
        state_code="S29",
        state_name="Telangana",
        ac_number=spec.ac_number,
        ac_name=spec.ac_name,
        ac_reservation=spec.ac_reservation,
        pc_number=spec.pc_number,
        pc_name=spec.pc_name,
        pc_reservation=spec.pc_reservation,
        part_number=spec.part_number,
        revision_year=2026,
        revision_type="Special Intensive Revision 2026",
        qualifying_date=date(2026, 10, 1),
        publication_date=date(2026, 8, 17),
        roll_identification="Draft Electoral Roll of Special Intensive Revision, 2026",
        sections=sections,
        main_town=town,
        post_office=town,
        police_station=_place_name(rng),
        mandal=_place_name(rng),
        subdivision="SANGAREDDY",
        district="SANGAREDDY",
        pin_code=f"50{rng.randint(1000, 9999)}",
        polling_station=PollingStation(
            number=str(spec.part_number),
            name=station_name,
            address=f"{station_name}, Room No 1",
        ),
        station_type="GENERAL",
        auxiliary_station_count=spec.auxiliary_stations,
        auxiliary_stations=[
            PollingStation(
                number=f"{spec.part_number}{string.ascii_uppercase[i]}",
                name=f"{station_name}, Room No {i + 2}",
                address=f"{station_name}, Room No {i + 2}",
            )
            for i in range(spec.auxiliary_stations)
        ],
    )

    voter_pages = page - 3
    return RollTruth(
        header=header,
        printed_totals=PrintedTotals(start_serial=1, end_serial=total, counts=counts),
        summary=[SummaryRow(roll_type="Mother Roll", counts=counts)],
        pages=[PageKind.COVER, PageKind.MAPS, *[PageKind.VOTERS] * voter_pages, PageKind.SUMMARY],
        voters=voters,
    )
