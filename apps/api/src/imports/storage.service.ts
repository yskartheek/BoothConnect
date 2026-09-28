import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';

/**
 * The private import bucket (S3 API; MinIO locally). Browsers upload straight
 * to it with presigned multipart URLs; the API never proxies file bytes on the
 * way in, and nothing in the bucket is public.
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly s3: S3Client;
  readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.s3 = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
    this.bucket = config.get('S3_BUCKET_IMPORTS', { infer: true });
  }

  onModuleDestroy(): void {
    this.s3.destroy();
  }

  /** Creates the bucket if it's missing (`pnpm infra:up` normally does this). */
  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async startMultipart(key: string, contentType: string): Promise<string> {
    const { UploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!UploadId) throw new Error('The object store returned no upload id');
    return UploadId;
  }

  /** One presigned PUT URL per part, numbered from 1. */
  async partUrls(key: string, uploadId: string, parts: number, ttlSeconds: number) {
    const urls: { partNumber: number; url: string }[] = [];
    for (let partNumber = 1; partNumber <= parts; partNumber += 1) {
      const url = await getSignedUrl(
        this.s3,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: ttlSeconds },
      );
      urls.push({ partNumber, url });
    }
    return urls;
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.s3
      .send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }))
      .catch(() => undefined);
  }

  /** The stored object's size in bytes, or null if there is none. */
  async size(key: string): Promise<number | null> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  async read(key: string): Promise<Readable> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return object.Body as Readable;
  }

  async writeFile(key: string, path: string, size: number, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }
}
