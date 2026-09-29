import { Module } from '@nestjs/common';

import {
  BullExtractionQueue,
  DEFAULT_JOB_OPTIONS,
  EXTRACTION_JOB_OPTIONS,
} from './extraction/bull-extraction.queue';
import { ExtractionResultsService } from './extraction/results.service';
import { ExtractionQueue } from './extraction-queue';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [ImportsController],
  providers: [
    ImportsService,
    StorageService,
    ExtractionResultsService,
    { provide: EXTRACTION_JOB_OPTIONS, useValue: DEFAULT_JOB_OPTIONS },
    { provide: ExtractionQueue, useClass: BullExtractionQueue },
  ],
  exports: [StorageService, ExtractionQueue, ExtractionResultsService],
})
export class ImportsModule {}
