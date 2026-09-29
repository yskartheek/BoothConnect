import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import type { Actor } from '../common/actor';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import {
  type GeographyNodeType,
  type ImportBatchStatus,
  type ImportFileStatus,
  type ImportUploadKind,
  Prisma,
} from '../generated/prisma/client';
import { refreshBatchStatus } from './batch-status';
import type { CompleteUploadDto, StartUploadsDto } from './dto';
import { ExtractionQueue } from './extraction-queue';
import { StorageService } from './storage.service';
import { BadZip, saveAndHash, TooLarge, unpackPdfs, withTempDir } from './zip';

/** Browsers upload in 16 MiB parts (S3 needs at least 5 MiB, except the last). */
export const PART_SIZE_BYTES = 16 * 1024 * 1024;
const CONTENT_TYPES: Record<ImportUploadKind, string[]> = {
  pdf: ['application/pdf'],
  zip: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
};

export interface BatchView {
  id: string;
  targetNode: { id: string; type: GeographyNodeType; code: string; name: string };
  status: ImportBatchStatus;
  fileCount: number;
  createdAt: Date;
}

export interface UploadTicket {
  id: string;
  kind: ImportUploadKind;
  originalName: string;
  sizeBytes: number;
  partSizeBytes: number;
  /** PUT each part to its URL; keep each response's ETag for `complete`. */
  parts: { partNumber: number; url: string }[];
  expiresAt: Date;
}

export interface ImportedFile {
  id: string;
  originalName: string;
  sizeBytes: number;
  status: ImportFileStatus;
  /** For a duplicate: the file already imported with the same content. */
  duplicateOfId: string | null;
}

export interface UploadCompleted {
  uploadId: string;
  files: ImportedFile[];
  /** ZIP entries that weren't imported, and why. */
  skipped: { name: string; reason: string }[];
}

type Skipped = { name: string; reason: string };
type Outcome =
  | { error: string; skipped?: Skipped[] }
  | {
      pdfs: { key: string; name: string; size: number; sha256: string }[];
      skipped: Skipped[];
    };

const unprocessable = (message: string, details?: unknown) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, message, details);

/**
 * Roll imports, step 1 (#44; design `docs/design/voter-roll-pdf-import.md`
 * §3): an admin opens a batch at any level of their area, uploads PDFs or
 * ZIPs of PDFs straight to the private bucket, and completing an upload turns
 * it into one import_file per PDF: duplicates flagged, the rest queued for
 * extraction.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: ExtractionQueue,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async createBatch(scope: Scope, actor: Actor, targetNodeId: string): Promise<BatchView> {
    const target = await this.nodeInScope(scope, targetNodeId);
    if (!target) throw notFound('Geography node');
    if (target.type === 'polling_station') {
      throw unprocessable('Upload rolls at State, PC, AC or Part level');
    }
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: { programId: target.programId, targetNodeId, uploadedById: actor.userId },
      });
      await this.audit.record(
        {
          ...auditBase(actor),
          action: 'import.batch.create',
          resourceType: 'import_batch',
          resourceId: created.id,
          metadata: { targetNodeId, targetType: target.type },
        },
        tx,
      );
      return created;
    });
    return this.view(batch.id);
  }

  async startUploads(
    scope: Scope,
    actor: Actor,
    batchId: string,
    dto: StartUploadsDto,
  ): Promise<{ uploads: UploadTicket[] }> {
    const batch = await this.batchInScope(scope, batchId);
    if (batch.status === 'completed' || batch.status === 'cancelled') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'This batch is closed for uploads',
      );
    }
    const maxPdf = this.config.get('IMPORT_MAX_PDF_BYTES', { infer: true });
    const maxZip = this.config.get('IMPORT_MAX_ZIP_BYTES', { infer: true });
    const requests = dto.files.map((file) => {
      const kind = kindOf(file.name);
      if (!kind) throw unprocessable(`"${file.name}" is not a .pdf or .zip file`);
      if (file.contentType && !CONTENT_TYPES[kind].includes(file.contentType)) {
        throw unprocessable(`"${file.name}" has the wrong content type for a ${kind}`);
      }
      const max = kind === 'pdf' ? maxPdf : maxZip;
      if (file.sizeBytes > max) {
        throw new AppException(
          HttpStatus.PAYLOAD_TOO_LARGE,
          ErrorCode.PAYLOAD_TOO_LARGE,
          `"${file.name}" is larger than ${max} bytes`,
        );
      }
      return { ...file, kind };
    });
    if (batch.targetNode.type === 'part') {
      // A part is one roll: exactly one PDF, no ZIPs.
      const earlier = await this.prisma.importUpload.count({
        where: { batchId, status: { not: 'failed' } },
      });
      if (earlier > 0 || requests.length !== 1 || requests[0]?.kind !== 'pdf') {
        throw unprocessable('A part-level batch takes exactly one PDF');
      }
    }

    const ttl = this.config.get('IMPORT_UPLOAD_URL_TTL_SECONDS', { infer: true });
    const uploads: UploadTicket[] = [];
    for (const request of requests) {
      const id = randomUUID();
      const objectKey = `imports/${batchId}/uploads/${id}.${request.kind}`;
      const s3UploadId = await this.storage.startMultipart(
        objectKey,
        request.kind === 'pdf' ? 'application/pdf' : 'application/zip',
      );
      await this.prisma.importUpload.create({
        data: {
          id,
          batchId,
          kind: request.kind,
          objectKey,
          originalName: request.name,
          sizeBytes: request.sizeBytes,
          s3UploadId,
          createdById: actor.userId,
        },
      });
      const partCount = Math.max(1, Math.ceil(request.sizeBytes / PART_SIZE_BYTES));
      uploads.push({
        id,
        kind: request.kind,
        originalName: request.name,
        sizeBytes: request.sizeBytes,
        partSizeBytes: PART_SIZE_BYTES,
        parts: await this.storage.partUrls(objectKey, s3UploadId, partCount, ttl),
        expiresAt: new Date(Date.now() + ttl * 1000),
      });
    }
    await this.audit.record({
      ...auditBase(actor),
      action: 'import.upload.start',
      resourceType: 'import_batch',
      resourceId: batchId,
      metadata: {
        uploads: uploads.map((u) => ({ id: u.id, kind: u.kind, sizeBytes: u.sizeBytes })),
      },
    });
    return { uploads };
  }

  /**
   * Checks the uploaded object (size, PDF signature), hashes it, and turns
   * it into import files: the PDF itself, or each PDF inside the ZIP. New
   * files are queued for extraction (status `extracting`). Completing again
   * returns the same files.
   */
  async completeUpload(
    scope: Scope,
    actor: Actor,
    batchId: string,
    uploadId: string,
    dto: CompleteUploadDto,
  ): Promise<UploadCompleted> {
    const batch = await this.batchInScope(scope, batchId);
    const upload = await this.prisma.importUpload.findFirst({ where: { id: uploadId, batchId } });
    if (!upload) throw notFound('Upload');
    if (upload.status === 'completed') return this.completed(upload.id, []);
    if (upload.status === 'failed') {
      throw unprocessable('This upload failed; start a new one', upload.error);
    }

    try {
      await this.storage.completeMultipart(upload.objectKey, upload.s3UploadId, dto.parts);
    } catch (error) {
      // Parts missing or ETags wrong: the admin can retry `complete`.
      throw unprocessable('The upload is incomplete: every part must be uploaded first', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
    const stored = await this.storage.size(upload.objectKey);
    if (stored !== Number(upload.sizeBytes)) {
      return this.fail(
        upload.id,
        `The stored file has ${stored ?? 0} bytes, not ${upload.sizeBytes}`,
      );
    }

    const maxPdf = this.config.get('IMPORT_MAX_PDF_BYTES', { infer: true });
    const maxZip = this.config.get('IMPORT_MAX_ZIP_BYTES', { infer: true });
    const outcome: Outcome = await withTempDir(async (dir): Promise<Outcome> => {
      const saved = await saveAndHash(
        await this.storage.read(upload.objectKey),
        join(dir, `upload.${upload.kind}`),
        upload.kind === 'pdf' ? maxPdf : maxZip,
      );
      if (upload.kind === 'pdf') {
        if (!saved.isPdf) return { error: 'The file is not a PDF' };
        return {
          pdfs: [{ key: upload.objectKey, name: upload.originalName, ...saved }],
          skipped: [],
        };
      }
      if (batch.targetNode.type === 'part') return { error: 'A part-level batch takes one PDF' };
      try {
        const unpacked = await unpackPdfs(saved.path, dir, maxPdf, maxZip * 4);
        if (unpacked.pdfs.length === 0) {
          return { error: 'The ZIP has no PDF files', skipped: unpacked.skipped };
        }
        const pdfs = [];
        for (const pdf of unpacked.pdfs) {
          const key = `imports/${batchId}/files/${randomUUID()}.pdf`;
          await this.storage.writeFile(key, pdf.path, pdf.size, 'application/pdf');
          pdfs.push({ ...pdf, key, name: pdf.name.split('/').pop() ?? pdf.name });
        }
        return { pdfs, skipped: unpacked.skipped };
      } catch (error) {
        if (error instanceof BadZip) return { error: `The ZIP can't be read: ${error.message}` };
        throw error;
      }
    }).catch((error: unknown): Outcome => {
      if (error instanceof TooLarge) return { error: `The file is ${error.message}` };
      throw error;
    });
    if ('error' in outcome) return this.fail(upload.id, outcome.error, outcome.skipped);

    const created = await this.prisma.$transaction(async (tx) => {
      const current = await tx.importUpload.findUniqueOrThrow({ where: { id: upload.id } });
      if (current.status !== 'pending') return null; // completed by a concurrent call
      const files: ImportedFile[] = [];
      for (const pdf of outcome.pdfs) {
        files.push(
          await this.addFile(tx, {
            batchId,
            programId: batch.programId,
            uploadId: upload.id,
            key: pdf.key,
            name: pdf.name,
            size: pdf.size,
            sha256: pdf.sha256,
          }),
        );
      }
      await tx.importUpload.update({
        where: { id: upload.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      await tx.importBatch.update({
        where: { id: batchId },
        data: { fileCount: { increment: files.length } },
      });
      await this.audit.record(
        {
          ...auditBase(actor),
          action: 'import.upload.complete',
          resourceType: 'import_batch',
          resourceId: batchId,
          metadata: {
            uploadId: upload.id,
            kind: upload.kind,
            files: files.length,
            duplicates: files.filter((f) => f.status === 'duplicate').length,
            skipped: outcome.skipped.length,
          },
        },
        tx,
      );
      return files;
    });
    if (!created) return this.completed(upload.id, outcome.skipped);

    // Hand the new files to the roll-parser. If the queue is unreachable they
    // stay `uploaded`, and the results sweep sends them later.
    for (const file of created) {
      if (file.status !== 'uploaded') continue;
      const stored = await this.prisma.importFile.findUniqueOrThrow({ where: { id: file.id } });
      try {
        await this.queue.enqueue({
          importFileId: file.id,
          bucket: this.storage.bucket,
          key: stored.fileRef,
          sha256: stored.checksum,
        });
      } catch (error) {
        this.logger.warn(`import file ${file.id}: not queued yet (${(error as Error).message})`);
        continue;
      }
      await this.prisma.importFile.updateMany({
        where: { id: file.id, status: 'uploaded' },
        data: { status: 'extracting' },
      });
      file.status = 'extracting';
    }
    await this.prisma.$transaction((tx) => refreshBatchStatus(tx, batchId));
    return { uploadId: upload.id, files: created, skipped: outcome.skipped };
  }

  /**
   * One import file. Same content as a file already imported in this program
   * (and not itself a duplicate, rejected or failed): status `duplicate`.
   */
  private async addFile(
    tx: Prisma.TransactionClient,
    file: {
      batchId: string;
      programId: string;
      uploadId: string;
      key: string;
      name: string;
      size: number;
      sha256: string;
    },
  ): Promise<ImportedFile> {
    const original = await tx.importFile.findFirst({
      where: {
        programId: file.programId,
        checksum: file.sha256,
        status: { notIn: ['duplicate', 'rejected', 'failed'] },
      },
      select: { id: true },
    });
    const row = await tx.importFile.create({
      data: {
        batchId: file.batchId,
        programId: file.programId,
        uploadId: file.uploadId,
        fileRef: file.key,
        originalName: file.name,
        sizeBytes: file.size,
        checksum: file.sha256,
        status: original ? 'duplicate' : 'uploaded',
        duplicateOfId: original?.id ?? null,
      },
    });
    return viewFile(row);
  }

  private async fail(uploadId: string, message: string, skipped?: Skipped[]): Promise<never> {
    const error = { message, ...(skipped?.length ? { skipped } : {}) };
    await this.prisma.importUpload.update({
      where: { id: uploadId },
      data: { status: 'failed', error, completedAt: new Date() },
    });
    this.logger.warn(`import upload ${uploadId} failed: ${message}`);
    throw unprocessable(message, skipped?.length ? { skipped } : undefined);
  }

  private async completed(
    uploadId: string,
    skipped: { name: string; reason: string }[],
  ): Promise<UploadCompleted> {
    const files = await this.prisma.importFile.findMany({
      where: { uploadId },
      orderBy: { createdAt: 'asc' },
    });
    return { uploadId, files: files.map(viewFile), skipped };
  }

  /** The node, if it is one of the caller's assigned nodes or below one. */
  private async nodeInScope(scope: Scope, nodeId: string) {
    return this.prisma.geographyNode.findFirst({
      where: {
        id: nodeId,
        ancestors: { some: { ancestorId: { in: scope.nodeIds } } },
      },
    });
  }

  private async batchInScope(scope: Scope, batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { targetNode: true },
    });
    if (!batch || !(await this.nodeInScope(scope, batch.targetNodeId))) throw notFound('Batch');
    return batch;
  }

  private async view(batchId: string): Promise<BatchView> {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { targetNode: { select: { id: true, type: true, code: true, name: true } } },
    });
    return {
      id: batch.id,
      targetNode: batch.targetNode,
      status: batch.status,
      fileCount: batch.fileCount,
      createdAt: batch.createdAt,
    };
  }
}

function kindOf(name: string): ImportUploadKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

function viewFile(row: {
  id: string;
  originalName: string;
  sizeBytes: bigint;
  status: ImportFileStatus;
  duplicateOfId: string | null;
}): ImportedFile {
  return {
    id: row.id,
    originalName: row.originalName,
    sizeBytes: Number(row.sizeBytes),
    status: row.status,
    duplicateOfId: row.duplicateOfId,
  };
}

export const auditBase = (actor: Actor) => ({
  result: 'success' as const,
  actorId: actor.userId,
  sessionId: actor.sessionId ?? null,
  requestId: actor.requestId ?? null,
});
