"""Synthetic electoral rolls with ground truth, for tests. Fake data only."""

from pathlib import Path

from roll_parser.model import RollTruth
from roll_parser.synthetic.data import RollSpec, generate
from roll_parser.synthetic.presets import PRESETS, Preset
from roll_parser.synthetic.render import Degradation, draw_vector, rasterise

__all__ = [
    "PRESETS",
    "Degradation",
    "Preset",
    "RollSpec",
    "build",
    "draw_vector",
    "generate",
    "rasterise",
    "write",
]


def build(spec: RollSpec, degradation: Degradation | None = None) -> tuple[bytes, RollTruth]:
    """Image-only roll PDF and its ground truth."""
    truth = generate(spec)
    doc = rasterise(draw_vector(truth, spec.box_style), degradation, seed=spec.seed)
    return doc.tobytes(garbage=3, deflate=True), truth


def write(preset: Preset, out_dir: Path) -> tuple[Path, Path]:
    """Write ``<name>.pdf`` and ``<name>.json`` (ground truth) into ``out_dir``."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf, truth = build(preset.spec, preset.degradation)
    pdf_path = out_dir / f"{preset.name}.pdf"
    json_path = out_dir / f"{preset.name}.json"
    pdf_path.write_bytes(pdf)
    json_path.write_text(truth.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return pdf_path, json_path
