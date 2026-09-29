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
import { ApiTags } from '@nestjs/swagger';
import { ApiFile, ApiResult } from '../openapi/api-result';

/** Roll imports (admins only; design §3, §6). */
@ApiTags('Imports')
@Controller('imports')
@Roles('admin')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly review: ImportReviewService,
    private readonly confirm: ImportConfirmService,
  ) {}

  @ApiResult('BatchView', 201)
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
  @ApiResult('UploadTickets', 201)
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
  @ApiResult('UploadCompleted')
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
  @ApiResult('BatchDetail')
  @Get('batches/:id')
  batch(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BatchDetail> {
    return this.review.batch(scope, id);
  }

  /** Header, proposed part and stations, totals check, and rows to review (paged). */
  @ApiResult('FilePreview')
  @Get('files/:id/preview')
  preview(
    @CurrentScope() scope: Scope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PreviewQuery,
  ): Promise<FilePreview> {
    return this.review.preview(scope, id, query);
  }

  /** A voter page as JPEG, for checking rows against the roll. Never cached. */
  @ApiFile('image/jpeg')
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

  /** The rejected and warning rows as CSV (formula-injection safe); audited. */
  @ApiFile('text/csv')
  @Get('files/:id/rejections.csv')
  @Header('Cache-Control', 'private, no-store')
  async rejectionsCsv(
    @CurrentScope() scope: Scope,
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { id?: unknown },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { filename, csv } = await this.review.rejectionsCsv(scope, actorOf(user, req), id);
    return new StreamableFile(csv, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  /** Correct fields of a row, or reject it; the extracted values are kept. */
  @ApiResult('ReviewRow')
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
  @ApiResult('ConfirmQueued', 202)
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
  @ApiResult('BatchConfirmResult', 202)
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
