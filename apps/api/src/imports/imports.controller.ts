import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import {
  type BatchConfirmResult,
  type ConfirmQueued,
  ImportConfirmService,
} from './confirm.service';
import {
  CompleteUploadDto,
  ConfirmFileDto,
  CorrectRowDto,
  CreateBatchDto,
  PreviewQuery,
  StartUploadsDto,
} from './dto';
import {
  type BatchView,
  ImportsService,
  type UploadCompleted,
  type UploadTicket,
} from './imports.service';
import {
  type BatchDetail,
  type FilePreview,
  ImportReviewService,
  type ReviewRow,
} from './review.service';

/** Roll imports (admins only; design §3, §6). */
@Controller('imports')
@Roles('admin')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly review: ImportReviewService,
    private readonly confirm: ImportConfirmService,
  ) {}

  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  createBatch(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: CreateBatchDto,
  ): Promise<BatchView> {
    return this.imports.createBatch(scope, actorOf(user, req), dto.targetNodeId);
  }

  /** Presigned multipart upload URLs, one upload per file (PDF or ZIP of PDFs). */
  @Post('batches/:id/files')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  startUploads(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartUploadsDto,
  ): Promise<{ uploads: UploadTicket[] }> {
    return this.imports.startUploads(scope, actorOf(user, req), id, dto);
  }

  /** Finish an upload: verify, hash, unpack ZIPs, flag duplicates, queue extraction. */
  @Post('batches/:id/files/:fileId/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<UploadCompleted> {
    return this.imports.completeUpload(scope, actorOf(user, req), id, fileId, dto);
  }

  /** Progress of every file: status, part, page and voter counts, quality score. */
  @Get('batches/:id')
  batch(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BatchDetail> {
    return this.review.batch(scope, id);
  }

  /** Header, proposed part and stations, totals check, and rows to review (paged). */
  @Get('files/:id/preview')
  preview(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PreviewQuery,
  ): Promise<FilePreview> {
    return this.review.preview(scope, id, query);
  }

  /** A voter page as JPEG, for checking rows against the roll. Never cached. */
  @Get('files/:id/pages/:page')
  @Header('Cache-Control', 'private, no-store')
  async pageImage(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('page', ParseIntPipe) page: number,
  ): Promise<StreamableFile> {
    const image = await this.review.pageImage(scope, id, page);
    return new StreamableFile(image, { type: 'image/jpeg' });
  }

  /** Correct fields of a row, or reject it; the extracted values are kept. */
  @Patch('files/:id/rows/:rowId')
  correctRow(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: CorrectRowDto,
  ): Promise<ReviewRow> {
    return this.review.correctRow(scope, actorOf(user, req), id, rowId, dto);
  }

  /**
   * Confirm a reviewed file: its rows are committed to the active dataset
   * in the background (the file is `confirming`, then `confirmed`).
   */
  @Post('files/:id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  confirmFile(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmFileDto,
  ): Promise<ConfirmQueued> {
    return this.confirm.confirmFile(
      scope,
      actorOf(user, req),
      id,
      dto.acceptTotalsMismatch ?? false,
    );
  }

  /** Confirm every `ready` file of the batch; files that still need review are left. */
  @Post('batches/:id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  confirmBatch(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BatchConfirmResult> {
    return this.confirm.confirmBatch(scope, actorOf(user, req), id);
  }
}
