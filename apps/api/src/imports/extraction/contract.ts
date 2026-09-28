// The roll-parser job/result contract, v1, as the API sees it. Source of
// truth: apps/roll-parser/src/roll_parser/worker/contract.py and the JSON
// Schemas in apps/roll-parser/contract/; explained in
// docs/design/roll-parser-contract.md. All JSON is camelCase.

export const CONTRACT_VERSION = 1;
export const JOB_NAME = 'extract-roll';

/** `job.data` of an `extract-roll` job. */
export interface JobPayload {
  version: 1;
  importFileId: string;
  bucket: string;
  key: string;
  sha256: string;
  resultPrefix: string;
  options: { pageImages: boolean };
}

/** An extracted value: `value` is null when missing or unreadable. */
export interface Field<T> {
  value: T | null;
  raw?: string;
  confidence?: number;
}

export interface Issue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  field?: string | null;
  page?: number | null;
}

export interface ElectorCounts {
  male: number;
  female: number;
  thirdGender: number;
  total: number;
}

export interface PageImage {
  page: number;
  kind: string;
  key: string;
  width: number;
  height: number;
}

export interface ExtractedStation {
  number: Field<string>;
  name: Field<string>;
  address: Field<string>;
}

/** The cover page; every leaf is a Field (only the parts the API reads are typed). */
export interface ExtractedHeader {
  stateCode: Field<string>;
  stateName: Field<string>;
  acNumber: Field<number>;
  acName: Field<string>;
  pcNumber: Field<number>;
  pcName: Field<string>;
  partNumber: Field<number>;
  revisionYear: Field<number>;
  revisionType: Field<string>;
  mainTown: Field<string>;
  pollingStation: ExtractedStation;
  auxiliaryStations: ExtractedStation[];
  [key: string]: unknown;
}

export interface ExtractedVoter {
  page: number;
  boxIndex: number;
  serial: number;
  sectionNumber: Field<number>;
  printedSerial: Field<number>;
  epic: Field<string>;
  name: Field<string>;
  relationType: Field<string>;
  relativeName: Field<string>;
  houseNumber: Field<string>;
  age: Field<number>;
  gender: Field<string>;
  marker: 'deleted' | 'modified' | null;
  rawText: string;
  issues: Issue[];
}

/** `result.v1.json` in the bucket. Contains voter data: never log it. */
export interface ResultDocument {
  version: 1;
  importFileId: string;
  workerVersion: string;
  method?: string;
  pageImages: PageImage[];
  extraction: {
    pageCount: number;
    method?: string;
    qualityScore: number;
    extractedTotals: ElectorCounts;
    issues: Issue[];
    header: {
      pages: string[];
      header: ExtractedHeader | null;
      printedTotals: {
        startSerial: Field<number>;
        endSerial: Field<number>;
        counts: { [K in keyof ElectorCounts]: Field<number> };
      } | null;
      issues: Issue[];
    };
    rows: ExtractedVoter[];
  };
}

/** The job's return value. */
export interface ResultEnvelope {
  version: 1;
  status: 'completed' | 'failed';
  importFileId: string;
  workerVersion: string;
  resultKey: string | null;
  pageImages: PageImage[];
  summary: {
    pageCount: number;
    rowCount: number;
    printedTotals: ElectorCounts | null;
    extractedTotals: ElectorCounts;
    qualityScore: number;
    needsReview: boolean;
    issueCounts: Record<string, number>;
  } | null;
  failure: { code: string; message: string } | null;
}
