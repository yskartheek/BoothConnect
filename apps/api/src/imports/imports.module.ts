import { Module } from '@nestjs/common';

import { ImportConfirmService } from './confirm.service';
import {
  BullExtractionQueue,
  DEFAULT_JOB_OPTIONS,
  EXTRACTION_JOB_OPTIONS,
} from './extraction/bull-extraction.queue';
import { ExtractionResultsService } from './extraction/results.service';
import { ExtractionQueue } from './extraction-queue';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportReviewService } from './review.service';
import { LoggingNodeStatsRefresh, NodeStatsRefresh } from './stats-refresh';
import { StorageService } from './storage.service';

@Module({
  controllers: [ImportsController],
  providers: [
    ImportsService,
    ImportReviewService,
    ImportConfirmService,
    { provide: NodeStatsRefresh, useClass: LoggingNodeStatsRefresh },
    StorageService,
    ExtractionResultsService,
    { provide: EXTRACTION_JOB_OPTIONS, useValue: DEFAULT_JOB_OPTIONS },
    { provide: ExtractionQueue, useClass: BullExtractionQueue },
  ],
  exports: [StorageService, ExtractionQueue, ExtractionResultsService, ImportConfirmService],
})
export class ImportsModule {}
