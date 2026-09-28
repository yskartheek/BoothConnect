"""One ``extract-roll`` job, start to finish (synchronous; runs in a thread).

Problems with the file itself (corrupt, encrypted, not a roll, too big, too
slow, wrong checksum) complete the job with ``status: "failed"`` and a
:class:`Failure`: retrying wouldn't help. Anything else (storage or network
errors) is raised, so BullMQ retries the job as the API configured it.
"""

import hashlib
import logging
import tempfile
import time
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import pymupdf
from pydantic import ValidationError

from roll_parser import __version__
from roll_parser.extract.images import render
from roll_parser.extract.roll import ExtractionTimeoutError, RollExtraction, extract_roll
from roll_parser.model import PageKind
from roll_parser.worker.contract import (
    Failure,
    FailureCode,
    JobPayload,
    PageImage,
    ResultDocument,
    ResultEnvelope,
    ResultSummary,
    SourceFile,
)
from roll_parser.worker.settings import Settings
from roll_parser.worker.storage import Storage

log = logging.getLogger("roll_parser.worker")

RESULT_FILE = "result.v1.json"


class _Fail(Exception):  # noqa: N818 (internal control flow, not an error type)
    def __init__(self, code: FailureCode, message: str) -> None:
        super().__init__(message)
        self.failure = Failure(code=code, message=message)


def _failed(import_file_id: str, failure: Failure) -> ResultEnvelope:
    return ResultEnvelope(
        status="failed",
        import_file_id=import_file_id,
        worker_version=__version__,
        failure=failure,
    )


def _open_checked(path: Path) -> int:
    """Page count, or a failure if the PDF can't be used."""
    try:
        with pymupdf.open(path) as doc:
            if doc.needs_pass:
                raise _Fail(FailureCode.PDF_ENCRYPTED, "The PDF is password-protected")
            if doc.page_count == 0:
                raise _Fail(FailureCode.PDF_UNREADABLE, "The PDF has no pages")
            return int(doc.page_count)
    except _Fail:
        raise
    except Exception as err:  # PyMuPDF raises several types for broken files
        raise _Fail(
            FailureCode.PDF_UNREADABLE, f"Not a readable PDF ({type(err).__name__})"
        ) from err


def render_page_images(
    path: Path, kinds: list[PageKind], payload: JobPayload, storage: Storage, quality: int
) -> list[PageImage]:
    """JPEGs of every page except the maps/photos page, for the review screen."""
    images = []
    with pymupdf.open(path) as doc:
        for index, kind in enumerate(kinds):
            if kind is PageKind.MAPS:
                continue  # never rendered, never stored
            image = render(doc[index])
            ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if not ok:  # pragma: no cover
                raise RuntimeError("JPEG encoding failed")
            key = f"{payload.prefix}pages/{index + 1}.jpg"
            storage.put(payload.bucket, key, jpeg.tobytes(), "image/jpeg")
            images.append(
                PageImage(
                    page=index + 1, kind=kind, key=key, width=image.shape[1], height=image.shape[0]
                )
            )
    return images


def _summary(extraction: RollExtraction) -> ResultSummary:
    issues = [*extraction.header.issues, *extraction.issues]
    issues += [i for row in extraction.rows for i in row.issues]
    printed = None
    totals = extraction.header.printed_totals
    if totals is not None:
        try:
            printed = totals.counts.values()
        except ValueError:
            printed = None
    return ResultSummary(
        page_count=extraction.page_count,
        row_count=len(extraction.rows),
        printed_totals=printed,
        extracted_totals=extraction.extracted_totals,
        quality_score=extraction.quality_score,
        needs_review=extraction.needs_review,
        issue_counts=dict(Counter(i.code for i in issues)),
    )


def process(data: Any, settings: Settings, storage: Storage, *, job_id: str = "") -> ResultEnvelope:
    started = time.monotonic()
    try:
        payload = JobPayload.model_validate(data)
    except ValidationError as err:
        file_id = str(data.get("importFileId", "unknown")) if isinstance(data, dict) else "unknown"
        fields = ", ".join(".".join(str(p) for p in e["loc"]) for e in err.errors())
        return _failed(
            file_id,
            Failure(code=FailureCode.INVALID_PAYLOAD, message=f"Invalid job data: {fields}"),
        )

    context = {"job_id": job_id, "import_file_id": payload.import_file_id}
    try:
        size = storage.size(payload.bucket, payload.key)
        if size > settings.max_bytes:
            raise _Fail(
                FailureCode.TOO_LARGE, f"File is {size} bytes; the limit is {settings.max_bytes}"
            )
        body = storage.get(payload.bucket, payload.key)
        sha256 = hashlib.sha256(body).hexdigest()
        if payload.sha256 and payload.sha256.lower() != sha256:
            raise _Fail(FailureCode.CHECKSUM_MISMATCH, "The file's SHA-256 doesn't match the job")

        with tempfile.TemporaryDirectory(prefix="roll-parser-") as tmp:
            path = Path(tmp) / "roll.pdf"
            path.write_bytes(body)
            _open_checked(path)
            try:
                extraction = extract_roll(
                    path, workers=settings.page_workers, timeout_seconds=settings.timeout_seconds
                )
            except ExtractionTimeoutError as err:
                raise _Fail(
                    FailureCode.TIMEOUT,
                    f"Extraction took longer than {settings.timeout_seconds:.0f} s",
                ) from err
            if PageKind.VOTERS not in extraction.header.pages:
                raise _Fail(
                    FailureCode.NOT_A_ROLL, "No voter pages found; this doesn't look like a roll"
                )
            images = (
                render_page_images(
                    path, extraction.header.pages, payload, storage, settings.page_image_quality
                )
                if payload.options.page_images
                else []
            )

        document = ResultDocument(
            import_file_id=payload.import_file_id,
            worker_version=__version__,
            source=SourceFile(
                bucket=payload.bucket, key=payload.key, sha256=sha256, size_bytes=size
            ),
            extraction=extraction,
            page_images=images,
        )
        result_key = f"{payload.prefix}{RESULT_FILE}"
        storage.put(
            payload.bucket, result_key, document.model_dump_json().encode(), "application/json"
        )
    except _Fail as fail:
        log.info(
            "extraction failed",
            extra={**context, "status": "failed", "failure_code": fail.failure.code,
                   "seconds": round(time.monotonic() - started, 2)},
        )  # fmt: skip
        return _failed(payload.import_file_id, fail.failure)

    summary = _summary(extraction)
    log.info(
        "extraction completed",
        extra={
            **context,
            "status": "completed",
            "page_count": summary.page_count,
            "row_count": summary.row_count,
            "quality_score": summary.quality_score,
            "needs_review": summary.needs_review,
            "issue_counts": summary.issue_counts,
            "size_bytes": size,
            "seconds": round(time.monotonic() - started, 2),
        },
    )
    return ResultEnvelope(
        status="completed",
        import_file_id=payload.import_file_id,
        worker_version=__version__,
        result_key=result_key,
        page_images=images,
        summary=summary,
        timings=extraction.timings,
    )
