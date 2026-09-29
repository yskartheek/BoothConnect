import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type Job, Worker } from 'bullmq';

import { bullConnection } from '../../src/imports/extraction/connection';
import type {
  ElectorCounts,
  ExtractedStation,
  ExtractedVoter,
  Field,
  JobPayload,
  ResultDocument,
  ResultEnvelope,
} from '../../src/imports/extraction/contract';
import type { StorageService } from '../../src/imports/storage.service';

/** What the fake roll-parser "reads" from a synthetic PDF. */
export interface Scenario {
  state?: string;
  pc?: number | null;
  ac?: number;
  part?: number;
  /** Rows to produce; each gets a made-up EPIC unless given. */
  rows?: { gender: 'male' | 'female'; epic?: string; issues?: ExtractedVoter['issues'] }[];
  /** Printed totals; default: the same as the rows. */
  printed?: ElectorCounts | null;
  needsReview?: boolean;
  /** A result the worker reports as failed (the job itself completes). */
  failure?: { code: string; message: string };
  /** Throw, as on a transient error (storage down): the job fails. */
  crash?: boolean;
}

const field = <T>(value: T | null, confidence = 0.95): Field<T> => ({
  value,
  raw: value === null ? '' : String(value),
  confidence,
});

const station = (number: string, name: string): ExtractedStation => ({
  number: field(number),
  name: field(name),
  address: field('Synthetic address'),
});

/**
 * Stands in for the Python roll-parser worker (apps/roll-parser), speaking the
 * same v1 contract: takes `extract-roll` jobs, reads the PDF from the bucket,
 * writes a synthetic `result.v1.json` and returns the envelope. The scenario
 * is chosen by the label inside the synthetic PDF (`fakePdf(label)`).
 */
export class FakeRollParser {
  readonly payloads: JobPayload[] = [];
  private readonly worker: Worker<JobPayload, ResultEnvelope>;
  private readonly s3: S3Client;

  constructor(
    private readonly storage: StorageService,
    private readonly scenarios: Map<string, Scenario>,
    redisUrl: string,
    s3: { endpoint: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.s3 = new S3Client({
      endpoint: s3.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
    this.worker = new Worker<JobPayload, ResultEnvelope>(
      'roll-extraction',
      (job) => this.process(job),
      { connection: bullConnection(redisUrl), prefix: 'bull', concurrency: 4 },
    );
  }

  async close(): Promise<void> {
    await this.worker.close();
    this.s3.destroy();
  }

  private async process(job: Job<JobPayload, ResultEnvelope>): Promise<ResultEnvelope> {
    this.payloads.push(job.data);
    const { importFileId, key, resultPrefix } = job.data;
    let text = '';
    for await (const chunk of await this.storage.read(key)) text += (chunk as Buffer).toString();
    const label = /synthetic test file: (\S+)/.exec(text)?.[1] ?? '';
    const scenario = this.scenarios.get(label);
    if (!scenario) throw new Error(`no scenario for "${label}"`);
    if (scenario.crash) throw new Error('storage unreachable');
    const base = {
      version: 1 as const,
      importFileId,
      workerVersion: 'fake',
      timings: null,
    };
    if (scenario.failure) {
      return {
        ...base,
        status: 'failed',
        resultKey: null,
        pageImages: [],
        summary: null,
        failure: scenario.failure,
      };
    }

    const rows: ExtractedVoter[] = (scenario.rows ?? []).map((row, i) => ({
      page: 3 + Math.floor(i / 30),
      boxIndex: i % 30,
      serial: i + 1,
      sectionNumber: field(1),
      printedSerial: field(i + 1),
      epic: field(row.epic ?? `TST${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`),
      name: field(`Synthetic Person ${i + 1}`, 0.7),
      relationType: field('father'),
      relativeName: field(`Synthetic Relative ${i + 1}`),
      houseNumber: field(`${i + 1}`),
      age: field(30 + i),
      gender: field(row.gender),
      marker: null,
      rawText: `${i + 1} synthetic`,
      issues: row.issues ?? [],
    }));
    const extracted: ElectorCounts = {
      male: rows.filter((r) => r.gender.value === 'male').length,
      female: rows.filter((r) => r.gender.value === 'female').length,
      thirdGender: 0,
      total: rows.length,
    };
    const printed = scenario.printed === undefined ? extracted : scenario.printed;
    const partNo = scenario.part ?? 1;
    const doc: ResultDocument = {
      version: 1,
      importFileId,
      workerVersion: 'fake',
      method: 'ocr',
      pageImages: [],
      extraction: {
        pageCount: 3 + Math.ceil(rows.length / 30),
        method: 'ocr',
        qualityScore: 0.9,
        extractedTotals: extracted,
        issues: [],
        header: {
          pages: ['cover', 'maps', 'voters', 'summary'],
          header: {
            stateCode: field(scenario.state ?? 'S99'),
            stateName: field('Synthetic State'),
            acNumber: field(scenario.ac ?? 101),
            acName: field('Synthetic AC'),
            pcNumber: field(scenario.pc === undefined ? 1 : scenario.pc),
            pcName: field('Synthetic PC'),
            partNumber: field(partNo),
            revisionYear: field(2026),
            revisionType: field('Special Intensive Revision 2026'),
            mainTown: field(`Synthetic Town ${partNo}`),
            pollingStation: station(String(partNo), `Synthetic School ${partNo}`),
            auxiliaryStations: partNo === 1 ? [station('1A', 'Synthetic Annexe')] : [],
          },
          printedTotals: printed
            ? {
                startSerial: field(1),
                endSerial: field(printed.total),
                counts: {
                  male: field(printed.male),
                  female: field(printed.female),
                  thirdGender: field(printed.thirdGender),
                  total: field(printed.total),
                },
              }
            : null,
          issues: [],
        },
        rows,
      },
    };
    const resultKey = `${resultPrefix}result.v1.json`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: resultKey,
        Body: JSON.stringify(doc),
        ContentType: 'application/json',
      }),
    );
    return {
      ...base,
      status: 'completed',
      resultKey,
      pageImages: [],
      summary: {
        pageCount: doc.extraction.pageCount,
        rowCount: rows.length,
        printedTotals: printed,
        extractedTotals: extracted,
        qualityScore: 0.9,
        needsReview: scenario.needsReview ?? false,
        issueCounts: {},
      },
      failure: null,
    };
  }
}
