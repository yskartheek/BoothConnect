"""End to end through Redis (BullMQ) and S3 (MinIO): enqueue a synthetic roll
and a corrupt PDF, run the worker, check the results.

Needs Redis and MinIO: `pnpm infra:up`, then `pnpm --filter roll-parser test:int`.
Settings come from the usual environment variables (REDIS_URL, S3_*).
"""

import asyncio
import contextlib
import dataclasses
import json
import os
import urllib.request
import uuid
from typing import Any

import pytest
from bullmq import Job, Queue

from roll_parser.worker.contract import JOB_NAME, ResultDocument, ResultEnvelope
from roll_parser.worker.main import run
from roll_parser.worker.settings import Settings
from roll_parser.worker.storage import Storage

from .conftest import FIXTURES

pytestmark = pytest.mark.integration

LOCAL_DEFAULTS = {
    "REDIS_URL": "redis://localhost:6379",
    "S3_ENDPOINT": "http://localhost:9000",
    "S3_ACCESS_KEY_ID": "boothconnect",
    "S3_SECRET_ACCESS_KEY": "boothconnect-dev-secret",
    "S3_FORCE_PATH_STYLE": "true",
    "S3_BUCKET_IMPORTS": "boothconnect-imports",
}


def env() -> dict[str, str]:
    return {**LOCAL_DEFAULTS, **os.environ}


async def wait_for(queue: Queue, job_id: str, seconds: float = 120) -> Any:
    for _ in range(int(seconds * 4)):
        state = await queue.getJobState(job_id)
        if state in ("completed", "failed"):
            return await Job.fromId(queue, job_id)
        await asyncio.sleep(0.25)
    raise AssertionError(f"job {job_id} didn't finish in {seconds} s")


def test_jobs_go_through_redis_and_minio() -> None:
    e = env()
    queue_name = f"roll-extraction-test-{uuid.uuid4().hex[:8]}"
    settings = dataclasses.replace(
        Settings.from_env(e), queue_name=queue_name, health_port=18090, page_workers=2
    )
    storage = Storage(settings)
    bucket = e["S3_BUCKET_IMPORTS"]
    with contextlib.suppress(storage.client.exceptions.BucketAlreadyOwnedByYou):
        storage.client.create_bucket(Bucket=bucket)
    storage.put(bucket, "test/small.pdf", (FIXTURES / "small.pdf").read_bytes(), "application/pdf")
    storage.put(bucket, "test/corrupt.pdf", b"%PDF-1.7 truncated", "application/pdf")

    async def scenario() -> tuple[Any, Any, dict[str, Any]]:
        stop = asyncio.Event()
        worker = asyncio.create_task(run(settings, stop))
        queue = Queue(queue_name, {"connection": settings.redis_url})
        try:
            ok = await queue.add(
                JOB_NAME,
                {
                    "version": 1,
                    "importFileId": "file-ok",
                    "bucket": bucket,
                    "key": "test/small.pdf",
                },
                {"attempts": 2},
            )
            bad = await queue.add(
                JOB_NAME,
                {
                    "version": 1,
                    "importFileId": "file-bad",
                    "bucket": bucket,
                    "key": "test/corrupt.pdf",
                },
                {"attempts": 2},
            )
            done_ok = await wait_for(queue, ok.id)
            done_bad = await wait_for(queue, bad.id)
            health = await asyncio.to_thread(
                lambda: json.loads(urllib.request.urlopen("http://127.0.0.1:18090/health").read())
            )
            return done_ok, done_bad, health
        finally:
            stop.set()
            await worker
            await queue.obliterate(force=True)
            await queue.close()

    done_ok, done_bad, health = asyncio.run(scenario())

    ok = ResultEnvelope.model_validate(done_ok.returnvalue)
    assert ok.status == "completed", done_ok.failedReason
    assert ok.summary is not None and ok.summary.row_count == 42
    assert ok.summary.extracted_totals.total == 40
    assert ok.result_key is not None
    document = ResultDocument.model_validate_json(storage.get(bucket, ok.result_key))
    assert len(document.extraction.rows) == 42
    assert [i.page for i in ok.page_images] == [1, 3, 4, 5]
    for image in ok.page_images:
        assert storage.size(bucket, image.key) > 10_000

    bad = ResultEnvelope.model_validate(done_bad.returnvalue)
    assert bad.status == "failed"
    assert bad.failure is not None and bad.failure.code == "pdf_unreadable"
    assert bad.failure.message

    assert health["status"] == "ok" and health["redis"] == "up"
