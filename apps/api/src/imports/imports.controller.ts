import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../auth/decorators';
import { CurrentScope, Roles } from '../authz/decorators';
import type { Scope } from '../authz/scope.service';
import { actorOf } from '../common/actor';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { CompleteUploadDto, CreateBatchDto, StartUploadsDto } from './dto';
import {
  type BatchView,
  ImportsService,
  type UploadCompleted,
  type UploadTicket,
} from './imports.service';

/** Roll imports (admins only; design §3, §6). */
@Controller('imports')
@Roles('admin')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

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
}
