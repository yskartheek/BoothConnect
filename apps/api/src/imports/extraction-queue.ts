export interface ExtractionRequest {
  importFileId: string;
  bucket: string;
  key: string;
  sha256: string;
}

/**
 * Where uploaded roll PDFs go to be extracted: the roll-parser worker, through
 * BullMQ `extract-roll` jobs (BullExtractionQueue). Tests replace it.
 */
export abstract class ExtractionQueue {
  abstract enqueue(request: ExtractionRequest): Promise<void>;
}
