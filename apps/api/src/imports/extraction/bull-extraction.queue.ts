import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type JobsOptions, Queue } from 'bullmq';

import type { Env } from '../../config/env';
import { ExtractionQueue, type ExtractionRequest } from '../extraction-queue';
import { bullConnection } from './connection';
import { CONTRACT_VERSION, JOB_NAME, type JobPayload } from './contract';

export const EXTRACTION_JOB_OPTIONS = Symbol('EXTRACTION_JOB_OPTIONS');

/**
 * As suggested by the contract: transient errors (storage, Redis) are retried
 * with backoff. Finished jobs are kept until the API has read their result
 * (it removes them then), so a result is never lost while the API is down.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: false,
  removeOnFail: false,
};

/** Publishes one `extract-roll` job per import file (job id = file id, so never twice). */
@Injectable()
export class BullExtractionQueue extends ExtractionQueue implements OnModuleDestroy {
  private readonly queue: Queue;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(EXTRACTION_JOB_OPTIONS) private readonly jobOptions: JobsOptions,
  ) {
    super();
    this.queue = new Queue(config.get('ROLL_PARSER_QUEUE', { infer: true }), {
      connection: bullConnection(config.get('REDIS_URL', { infer: true })),
      prefix: config.get('ROLL_PARSER_QUEUE_PREFIX', { infer: true }),
    });
  }

  async enqueue(request: ExtractionRequest): Promise<void> {
    const payload: JobPayload = {
      version: CONTRACT_VERSION,
      importFileId: request.importFileId,
      bucket: request.bucket,
      key: request.key,
      sha256: request.sha256,
      resultPrefix: `extractions/${request.importFileId}/`,
      options: { pageImages: true },
    };
    await this.queue.add(JOB_NAME, payload, { ...this.jobOptions, jobId: request.importFileId });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
