"""Object storage (MinIO locally, any S3-compatible service elsewhere)."""

from typing import TYPE_CHECKING

import boto3
from botocore.config import Config

from roll_parser.worker.settings import Settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.client: S3Client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=Config(
                s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    def size(self, bucket: str, key: str) -> int:
        return int(self.client.head_object(Bucket=bucket, Key=key)["ContentLength"])

    def get(self, bucket: str, key: str) -> bytes:
        return self.client.get_object(Bucket=bucket, Key=key)["Body"].read()

    def put(self, bucket: str, key: str, body: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)

    def ping(self) -> None:
        self.client.list_buckets()
