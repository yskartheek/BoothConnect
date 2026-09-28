"""Worker settings, from environment variables (same names as the API's .env)."""

import os
from dataclasses import dataclass


def _bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    redis_url: str
    queue_name: str
    queue_prefix: str
    s3_endpoint: str | None
    s3_region: str
    s3_access_key_id: str | None
    s3_secret_access_key: str | None
    s3_force_path_style: bool
    concurrency: int  # files at a time
    page_workers: int | None  # processes per file (None: one per CPU)
    timeout_seconds: float  # per file
    max_bytes: int
    health_port: int
    page_image_quality: int

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        e = dict(os.environ if env is None else env)
        from roll_parser.worker.contract import QUEUE_NAME

        page_workers = e.get("ROLL_PARSER_PAGE_WORKERS")
        return cls(
            redis_url=e.get("REDIS_URL", "redis://localhost:6379"),
            queue_name=e.get("ROLL_PARSER_QUEUE", QUEUE_NAME),
            queue_prefix=e.get("ROLL_PARSER_QUEUE_PREFIX", "bull"),
            s3_endpoint=e.get("S3_ENDPOINT") or None,
            s3_region=e.get("S3_REGION", "us-east-1"),
            s3_access_key_id=e.get("S3_ACCESS_KEY_ID") or None,
            s3_secret_access_key=e.get("S3_SECRET_ACCESS_KEY") or None,
            s3_force_path_style=_bool(e.get("S3_FORCE_PATH_STYLE", "false")),
            concurrency=int(e.get("ROLL_PARSER_CONCURRENCY", "1")),
            page_workers=int(page_workers) if page_workers else None,
            timeout_seconds=float(e.get("ROLL_PARSER_TIMEOUT_SECONDS", "600")),
            max_bytes=int(e.get("ROLL_PARSER_MAX_BYTES", str(100 * 1024 * 1024))),
            health_port=int(e.get("ROLL_PARSER_HEALTH_PORT", "8090")),
            page_image_quality=int(e.get("ROLL_PARSER_PAGE_IMAGE_QUALITY", "70")),
        )
