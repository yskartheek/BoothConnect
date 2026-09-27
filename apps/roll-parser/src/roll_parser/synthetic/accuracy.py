"""Compare an extraction with a synthetic roll's ground truth."""

from dataclasses import dataclass, field

from roll_parser.extract.roll import ExtractedVoter, RollExtraction
from roll_parser.model import RollTruth

FIELDS = [
    "serial",
    "epic",
    "name",
    "relation_type",
    "relative_name",
    "house_number",
    "age",
    "gender",
    "section_number",
    "marker",
]


@dataclass
class Accuracy:
    boxes_expected: int
    boxes_found: int
    correct: dict[str, int] = field(default_factory=dict)
    # (serial, field, expected, got) for every wrong value with no flag on that row
    unflagged: list[tuple[int, str, object, object]] = field(default_factory=list)
    wrong: list[tuple[int, str, object, object]] = field(default_factory=list)

    def rate(self, name: str) -> float:
        return self.correct.get(name, 0) / self.boxes_expected if self.boxes_expected else 0.0

    def report(self) -> str:
        lines = [f"boxes: {self.boxes_found} / {self.boxes_expected}"]
        lines += [f"{name:15s} {self.rate(name):7.2%}" for name in FIELDS]
        lines.append(f"wrong values: {len(self.wrong)}, of which unflagged: {len(self.unflagged)}")
        return "\n".join(lines)


def _value(row: ExtractedVoter, name: str) -> object:
    if name in ("serial", "marker"):
        return getattr(row, name)
    value: object = getattr(row, name).value
    return value


def _flagged(row: ExtractedVoter, name: str) -> bool:
    if name == "serial":
        return any(i.code.startswith("serial") for i in row.issues)
    return any(i.field is not None and i.field.endswith(f".{name}") for i in row.issues)


def compare(extraction: RollExtraction, truth: RollTruth) -> Accuracy:
    result = Accuracy(boxes_expected=len(truth.voters), boxes_found=len(extraction.rows))
    by_position = {(r.page, r.box_index): r for r in extraction.rows}
    for expected in truth.voters:
        row = by_position.get((expected.page, expected.box_index))
        if row is None:
            continue
        for name in FIELDS:
            want, got = getattr(expected, name), _value(row, name)
            if want == got:
                result.correct[name] = result.correct.get(name, 0) + 1
            else:
                result.wrong.append((expected.serial, name, want, got))
                # A wrong marker can't be flagged per field; any row issue counts
                if not (_flagged(row, name) or (name == "marker" and row.issues)):
                    result.unflagged.append((expected.serial, name, want, got))
    return result
