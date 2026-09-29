import type { Schemas } from '@boothconnect/api-client';

export type UploadTicket = Schemas['UploadTicket'];

/** PUTs one part to its presigned URL and returns the ETag storage gave it. */
export type PutPart = (
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
) => Promise<string>;

/** The ticket's URLs have expired: the file needs a new upload. */
export class UploadExpiredError extends Error {
  constructor() {
    super('The upload link has expired');
    this.name = 'UploadExpiredError';
  }
}

/** A part kept failing after every retry. */
export class PartFailedError extends Error {
  constructor(
    readonly partNumber: number,
    override readonly cause: unknown,
  ) {
    super(`Part ${partNumber} could not be uploaded`);
    this.name = 'PartFailedError';
  }
}

/**
 * Straight to object storage with XMLHttpRequest, which reports upload
 * progress (fetch doesn't). The bucket's CORS rules must allow PUT from the
 * portal and expose the ETag header.
 */
export const xhrPut: PutPart = (url, body, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader('ETag');
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error(etag ? `Storage answered ${xhr.status}` : 'No ETag in the response'));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });

/** Resolves when the browser is online (at once if it already is). */
export function whenOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve();
  return new Promise((resolve) =>
    window.addEventListener('online', () => resolve(), { once: true }),
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface UploadOptions {
  put?: PutPart;
  /** Bytes sent so far, of the whole file. */
  onProgress?: (sent: number) => void;
  /** A part failed and will be tried again (after going back online, if offline). */
  onRetry?: (partNumber: number, attempt: number) => void;
  signal?: AbortSignal;
  /** Tries after the first, per part. */
  retries?: number;
  /** Wait before try n (1-based): 1 s, 2 s, 4 s… */
  backoff?: (attempt: number) => number;
  wait?: (ms: number) => Promise<void>;
  online?: () => Promise<void>;
  now?: () => number;
}

/**
 * Uploads the parts of `file` that aren't in `done` yet, in order, and
 * returns every part's ETag for `complete`. `done` is filled in as parts
 * finish, so calling again after a failure resumes where it stopped. A part
 * that fails is tried again with a growing wait, after the connection comes
 * back.
 */
export async function uploadParts(
  file: Blob,
  ticket: UploadTicket,
  done: Map<number, string>,
  {
    put = xhrPut,
    onProgress,
    onRetry,
    signal = new AbortController().signal,
    retries = 4,
    backoff = (attempt) => 1000 * 2 ** (attempt - 1),
    wait = sleep,
    online = whenOnline,
    now = Date.now,
  }: UploadOptions = {},
): Promise<{ partNumber: number; etag: string }[]> {
  const sizeOf = (partNumber: number) =>
    Math.min(file.size, partNumber * ticket.partSizeBytes) -
    (partNumber - 1) * ticket.partSizeBytes;
  const sentBefore = () =>
    [...done.keys()].reduce((sum, partNumber) => sum + sizeOf(partNumber), 0);
  onProgress?.(sentBefore());

  for (const { partNumber, url } of ticket.parts) {
    if (done.has(partNumber)) continue;
    const start = (partNumber - 1) * ticket.partSizeBytes;
    const body = file.slice(start, start + ticket.partSizeBytes);
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      if (now() >= new Date(ticket.expiresAt).getTime()) throw new UploadExpiredError();
      await online();
      const base = sentBefore();
      try {
        const etag = await put(url, body, (loaded) => onProgress?.(base + loaded), signal);
        done.set(partNumber, etag);
        onProgress?.(sentBefore());
        break;
      } catch (error) {
        if (signal.aborted) throw error;
        if (attempt >= retries) throw new PartFailedError(partNumber, error);
        onRetry?.(partNumber, attempt + 1);
        await wait(backoff(attempt + 1));
      }
    }
  }
  return ticket.parts.map(({ partNumber }) => ({ partNumber, etag: done.get(partNumber)! }));
}
