import { Module } from '@nestjs/common';

import { ExtractionQueue, PendingExtractionQueue } from './extraction-queue';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [ImportsController],
  providers: [
    ImportsService,
    StorageService,
    { provide: ExtractionQueue, useClass: PendingExtractionQueue },
  ],
  exports: [StorageService, ExtractionQueue],
})
export class ImportsModule {}
