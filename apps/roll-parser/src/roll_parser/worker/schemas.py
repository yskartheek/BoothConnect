"""JSON Schemas of the contract, for the API side (``contract/*.schema.json``)."""

import json
from pathlib import Path

from pydantic import BaseModel

from roll_parser.worker.contract import JobPayload, ResultDocument, ResultEnvelope

CONTRACT_DIR = Path(__file__).resolve().parents[3] / "contract"

SCHEMAS: dict[str, type[BaseModel]] = {
    "extract-roll-job.v1.schema.json": JobPayload,
    "extract-roll-envelope.v1.schema.json": ResultEnvelope,
    "extract-roll-result.v1.schema.json": ResultDocument,
}


def schema_text(model: type[BaseModel]) -> str:
    schema = model.model_json_schema(by_alias=True, mode="serialization")
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def write_or_print(*, write: bool) -> int:
    for name, model in SCHEMAS.items():
        text = schema_text(model)
        if write:
            CONTRACT_DIR.mkdir(exist_ok=True)
            (CONTRACT_DIR / name).write_text(text, encoding="utf-8")
            print(f"wrote {CONTRACT_DIR / name}")
        else:
            print(f"--- {name}\n{text}")
    return 0
