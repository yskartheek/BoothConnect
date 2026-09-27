"""The extract-roll job processor (#99), with an in-memory bucket."""

import dataclasses
import hashlib
import json
import logging
from collections.abc import Iterator
from pathlib import Path

import pymupdf
import pytest

from roll_parser.model import RollTruth
from roll_parser.worker.contract import JobPayload, ResultDocument, ResultEnvelope
from roll_parser.worker.logs import JsonFormatter
from roll_parser.worker.process import process
from roll_parser.worker.schemas import CONTRACT_DIR, SCHEMAS, schema_text
from roll_parser.worker.settings import Settings

from .conftest import FIXTURES

BUCKET = "imports"
SMALL = (FIXTURES / "small.pdf").read_bytes()


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], tuple[bytes, str]] = {}

    def size(self, bucket: str, key: str) -> int:
        return len(self.objects[bucket, key][0])

    def get(self, bucket: str, key: str) -> bytes:
        return self.objects[bucket, key][0]

    def put(self, bucket: str, key: str, body: bytes, content_type: str) -> None:
        self.objects[bucket, key] = (body, content_type)


@pytest.fixture
def storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
def settings() -> Settings:
    return dataclasses.replace(Settings.from_env({}), page_workers=2)


def payload(key: str, **extra: object) -> dict[str, object]:
    return {"version": 1, "importFileId": "0192-file", "bucket": BUCKET, "key": key, **extra}


def run(storage: FakeStorage, settings: Settings, body: bytes, **extra: object) -> ResultEnvelope:
    storage.put(BUCKET, "uploads/roll.pdf", body, "application/pdf")
    return process(payload("uploads/roll.pdf", **extra), settings, storage, job_id="1")  # type: ignore[arg-type]


def test_a_roll_is_extracted_and_stored(storage: FakeStorage, settings: Settings) -> None:
    envelope = run(storage, settings, SMALL, sha256=hashlib.sha256(SMALL).hexdigest())
    assert envelope.status == "completed" and envelope.failure is None
    assert envelope.result_key == "extractions/0192-file/result.v1.json"
    assert envelope.summary is not None
    assert envelope.summary.row_count == 42
    assert envelope.summary.extracted_totals == envelope.summary.printed_totals
    assert not envelope.summary.needs_review

    body, content_type = storage.objects[BUCKET, envelope.result_key]
    assert content_type == "application/json"
    document = ResultDocument.model_validate_json(body)
    truth = RollTruth.model_validate_json((FIXTURES / "small.json").read_text("utf-8"))
    assert [row.values() for row in document.extraction.rows] == truth.voters
    assert document.source.sha256 == hashlib.sha256(SMALL).hexdigest()
    # camelCase JSON for the API
    raw = json.loads(body)
    assert "importFileId" in raw and "relativeName" in raw["extraction"]["rows"][0]


def test_page_images_skip_the_maps_page(storage: FakeStorage, settings: Settings) -> None:
    envelope = run(storage, settings, SMALL)
    assert [(i.page, i.kind) for i in envelope.page_images] == [
        (1, "cover"),
        (3, "voters"),
        (4, "voters"),
        (5, "summary"),
    ]
    image = storage.objects[BUCKET, "extractions/0192-file/pages/3.jpg"]
    assert image[1] == "image/jpeg" and image[0][:2] == b"\xff\xd8"
    assert (BUCKET, "extractions/0192-file/pages/2.jpg") not in storage.objects


def test_page_images_can_be_turned_off(storage: FakeStorage, settings: Settings) -> None:
    envelope = run(storage, settings, SMALL, options={"pageImages": False}, resultPrefix="x/y")
    assert envelope.page_images == []
    assert envelope.result_key == "x/y/result.v1.json"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (b"%PDF-1.7 this is not really a PDF", "pdf_unreadable"),
        (b"", "pdf_unreadable"),
        (b"hello", "pdf_unreadable"),
    ],
)
def test_broken_files_fail_with_a_reason(
    storage: FakeStorage, settings: Settings, body: bytes, code: str
) -> None:
    envelope = run(storage, settings, body)
    assert envelope.status == "failed"
    assert envelope.failure is not None and envelope.failure.code == code
    assert envelope.result_key is None
    assert all(not key.startswith("extractions/") for _, key in storage.objects)


def test_a_pdf_that_isnt_a_roll(storage: FakeStorage, settings: Settings) -> None:
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Minutes of the meeting")
    envelope = run(storage, settings, doc.tobytes())
    assert envelope.failure is not None and envelope.failure.code == "not_a_roll"


def test_encrypted_pdf(storage: FakeStorage, settings: Settings) -> None:
    doc = pymupdf.open()
    doc.new_page()
    aes_256 = pymupdf.PDF_ENCRYPT_AES_256  # type: ignore[attr-defined]  # missing from the stubs
    body = doc.tobytes(encryption=aes_256, user_pw="x", owner_pw="y")
    envelope = run(storage, settings, body)
    assert envelope.failure is not None and envelope.failure.code == "pdf_encrypted"


def test_checksum_mismatch(storage: FakeStorage, settings: Settings) -> None:
    envelope = run(storage, settings, SMALL, sha256="0" * 64)
    assert envelope.failure is not None and envelope.failure.code == "checksum_mismatch"


def test_too_large(storage: FakeStorage, settings: Settings) -> None:
    envelope = run(storage, dataclasses.replace(settings, max_bytes=1000), SMALL)
    assert envelope.failure is not None and envelope.failure.code == "too_large"


def test_timeout(storage: FakeStorage, settings: Settings) -> None:
    envelope = run(storage, dataclasses.replace(settings, timeout_seconds=0.5), SMALL)
    assert envelope.failure is not None and envelope.failure.code == "timeout"


def test_invalid_payload(storage: FakeStorage, settings: Settings) -> None:
    envelope = process({"importFileId": "abc", "version": 1}, settings, storage)  # type: ignore[arg-type]
    assert envelope.import_file_id == "abc"
    assert envelope.failure is not None and envelope.failure.code == "invalid_payload"
    assert "bucket" in envelope.failure.message


def test_storage_errors_are_raised_for_retry(storage: FakeStorage, settings: Settings) -> None:
    with pytest.raises(KeyError):
        process(payload("missing.pdf"), settings, storage)  # type: ignore[arg-type]


# --- logs and contract ------------------------------------------------------------


@pytest.fixture
def captured_logs(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    caplog.set_level(logging.INFO, logger="roll_parser.worker")
    yield caplog


def test_logs_are_json_without_voter_data(
    storage: FakeStorage, settings: Settings, captured_logs: pytest.LogCaptureFixture
) -> None:
    run(storage, settings, SMALL)
    lines = [JsonFormatter().format(r) for r in captured_logs.records]
    entries = [json.loads(line) for line in lines]
    done = next(e for e in entries if e["message"] == "extraction completed")
    assert done["import_file_id"] == "0192-file" and done["row_count"] == 42
    truth = RollTruth.model_validate_json((FIXTURES / "small.json").read_text("utf-8"))
    text = "\n".join(lines)
    for voter in truth.voters:
        assert voter.name not in text and voter.epic not in text and voter.house_number not in text


def test_log_fields_outside_the_allow_list_are_dropped() -> None:
    record = logging.LogRecord("x", logging.INFO, "f", 1, "hello", None, None)
    record.name_of_voter = "SOMEONE"
    record.row_count = 3
    entry = json.loads(JsonFormatter().format(record))
    assert entry["row_count"] == 3 and "name_of_voter" not in entry


@pytest.mark.parametrize("name", list(SCHEMAS))
def test_committed_json_schemas_match_the_models(name: str) -> None:
    """If this fails, run `uv run roll-parser contract --write` (and tell the API side)."""
    committed = json.loads((CONTRACT_DIR / name).read_text("utf-8"))
    assert committed == json.loads(schema_text(SCHEMAS[name]))


def test_payload_defaults() -> None:
    p = JobPayload.model_validate({"importFileId": "f1", "bucket": "b", "key": "k.pdf"})
    assert p.version == 1 and p.options.page_images and p.prefix == "extractions/f1/"
    assert Path(p.key).suffix == ".pdf"
