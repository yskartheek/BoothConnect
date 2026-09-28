"""Structured JSON logs, one object per line.

Rule: never log voter data. Log ids, counts, codes and timings only; the
fields allowed in ``extra`` are listed in ``ALLOWED``, anything else is
dropped.
"""

import json
import logging
import sys
from datetime import UTC, datetime

ALLOWED = {
    "job_id",
    "import_file_id",
    "attempt",
    "status",
    "failure_code",
    "page_count",
    "row_count",
    "quality_score",
    "needs_review",
    "issue_counts",
    "seconds",
    "size_bytes",
    "queue",
    "concurrency",
    "port",
    "error_type",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        entry.update({k: v for k, v in record.__dict__.items() if k in ALLOWED})
        return json.dumps(entry, default=str)


def setup(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Library chatter (and anything that might echo request bodies) stays quiet
    for noisy in ("botocore", "boto3", "urllib3", "s3transfer", "bullmq"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
