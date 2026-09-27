from collections.abc import Callable
from pathlib import Path

import pytest

from roll_parser import synthetic
from roll_parser.model import RollTruth

FIXTURES = Path(__file__).parent / "fixtures"

SyntheticRoll = tuple[Path, RollTruth]


@pytest.fixture(scope="session")
def synthetic_roll(
    tmp_path_factory: pytest.TempPathFactory,
) -> Callable[[str], SyntheticRoll]:
    """Generate a preset's PDF once per test run; returns (pdf path, truth)."""
    out_dir = tmp_path_factory.mktemp("synthetic-rolls")
    cache: dict[str, SyntheticRoll] = {}

    def get(name: str) -> SyntheticRoll:
        if name not in cache:
            pdf, truth_json = synthetic.write(synthetic.PRESETS[name], out_dir)
            truth = RollTruth.model_validate_json(truth_json.read_text(encoding="utf-8"))
            cache[name] = (pdf, truth)
        return cache[name]

    return get
