"""The job/result contract between the API (#45) and the roll-parser worker.

Documented for the API side in ``docs/design/roll-parser-contract.md``; the
JSON Schemas in ``apps/roll-parser/contract/`` are generated from these models
(``roll-parser contract --write``) and a test keeps them in sync.

Flow: the API uploads the PDF to the private bucket, then adds a BullMQ job
named ``extract-roll`` to the ``roll-extraction`` queue with a
:class:`JobPayload`. The worker writes the full :class:`ResultDocument` and the
page images to the same bucket, and completes the job with a small
:class:`ResultEnvelope` as its return value.
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from roll_parser.extract.fields import Issue
from roll_parser.extract.roll import RollExtraction, Timings
from roll_parser.model import ElectorCounts, PageKind, contract_config

CONTRACT_VERSION: Literal[1] = 1
QUEUE_NAME = "roll-extraction"
JOB_NAME = "extract-roll"


class _Contract(BaseModel):
    model_config = contract_config(frozen=True)


class JobOptions(_Contract):
    page_images: bool = Field(
        default=True, description="Render cover, voter and summary pages to JPEG for review"
    )


class JobPayload(_Contract):
    """``job.data`` of an ``extract-roll`` job."""

    version: Literal[1] = CONTRACT_VERSION
    import_file_id: str = Field(description="import_file.id; used in object keys and logs")
    bucket: str = Field(description="Private bucket holding the PDF")
    key: str = Field(description="Object key of the PDF")
    sha256: str | None = Field(
        default=None, description="Expected SHA-256 (hex); a mismatch fails the job"
    )
    result_prefix: str | None = Field(
        default=None,
        description='Where results go in the same bucket; default "extractions/<importFileId>/"',
    )
    options: JobOptions = JobOptions()

    @property
    def prefix(self) -> str:
        prefix = self.result_prefix or f"extractions/{self.import_file_id}/"
        return prefix if prefix.endswith("/") else f"{prefix}/"


class FailureCode(StrEnum):
    """Why a file couldn't be extracted. None of these is worth retrying."""

    CHECKSUM_MISMATCH = "checksum_mismatch"
    TOO_LARGE = "too_large"
    PDF_UNREADABLE = "pdf_unreadable"  # corrupt or not a PDF
    PDF_ENCRYPTED = "pdf_encrypted"
    NOT_A_ROLL = "not_a_roll"  # no cover and no voter pages recognised
    TIMEOUT = "timeout"
    INVALID_PAYLOAD = "invalid_payload"


class Failure(_Contract):
    code: FailureCode
    message: str = Field(description="For people; never contains voter data")


class PageImage(_Contract):
    page: int = Field(description="1-based page number in the PDF")
    kind: PageKind
    key: str = Field(description="Object key of the JPEG in the same bucket")
    width: int
    height: int


class ResultSummary(_Contract):
    page_count: int
    row_count: int
    printed_totals: ElectorCounts | None
    extracted_totals: ElectorCounts
    quality_score: float
    needs_review: bool
    issue_counts: dict[str, int] = Field(
        description="Issue code -> number of occurrences (file and rows)"
    )


class ResultEnvelope(_Contract):
    """The job's return value: small enough to live in Redis."""

    version: Literal[1] = CONTRACT_VERSION
    status: Literal["completed", "failed"]
    import_file_id: str
    worker_version: str
    result_key: str | None = Field(
        default=None, description="Object key of the ResultDocument JSON (completed only)"
    )
    page_images: list[PageImage] = []
    summary: ResultSummary | None = None
    failure: Failure | None = None
    timings: Timings | None = None


class SourceFile(_Contract):
    bucket: str
    key: str
    sha256: str
    size_bytes: int


class ResultDocument(_Contract):
    """The full result, stored as JSON in the bucket. Contains voter data."""

    version: Literal[1] = CONTRACT_VERSION
    import_file_id: str
    worker_version: str
    method: Literal["ocr"] = "ocr"
    source: SourceFile
    extraction: RollExtraction
    page_images: list[PageImage]


__all__ = [
    "CONTRACT_VERSION",
    "JOB_NAME",
    "QUEUE_NAME",
    "Failure",
    "FailureCode",
    "Issue",
    "JobOptions",
    "JobPayload",
    "PageImage",
    "ResultDocument",
    "ResultEnvelope",
    "ResultSummary",
    "SourceFile",
]
