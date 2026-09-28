import { Injectable, Logger } from '@nestjs/common';

export interface ExtractionRequest {
  importFileId: string;
  bucket: string;
  key: string;
  sha256: string;
}

/**
 * Where uploaded roll PDFs go to be extracted. #45 connects this to the
 * roll-parser worker (BullMQ `extract-roll` jobs); until then files wait in
 * status `uploaded`.
 */
export abstract class ExtractionQueue {
  abstract enqueue(request: ExtractionRequest): Promise<void>;
}

@Injectable()
export class PendingExtractionQueue extends ExtractionQueue {
  private readonly logger = new Logger('ExtractionQueue');

  enqueue(request: ExtractionRequest): Promise<void> {
    this.logger.debug(`import file ${request.importFileId} waits for extraction`);
    return Promise.resolve();
  }
}
