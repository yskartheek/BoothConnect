import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import yauzl from 'yauzl';

/** A ZIP never holds more files than this (an AC has ~300 parts). */
export const MAX_ZIP_ENTRIES = 2000;
const PDF_MAGIC = Buffer.from('%PDF-');

export interface HashedFile {
  path: string;
  size: number;
  sha256: string;
  /** Starts with the PDF signature. */
  isPdf: boolean;
}

/** Streams `source` to `path`, hashing it and stopping past `maxBytes`. */
export async function saveAndHash(
  source: Readable,
  path: string,
  maxBytes: number,
): Promise<HashedFile> {
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes) {
        done(new TooLarge(maxBytes));
        return;
      }
      if (head.length < PDF_MAGIC.length) head = Buffer.concat([head, chunk]).subarray(0, 8);
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(source, meter, createWriteStream(path));
  return {
    path,
    size,
    sha256: hash.digest('hex'),
    isPdf: head.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC),
  };
}

export class TooLarge extends Error {
  constructor(readonly maxBytes: number) {
    super(`larger than ${maxBytes} bytes`);
  }
}

export class BadZip extends Error {}

export interface ZipMember extends HashedFile {
  /** The entry's path inside the ZIP. */
  name: string;
}

export interface Unpacked {
  pdfs: ZipMember[];
  /** Entries that aren't PDFs (or are too large, or nested ZIPs), with why. */
  skipped: { name: string; reason: string }[];
}

/**
 * Unpacks the PDFs in a ZIP (already saved at `zipPath`) into `dir`, hashing
 * each. Folders, hidden files and macOS metadata are ignored; anything else
 * that isn't a PDF is reported as skipped. Sizes are checked as bytes are
 * read, so a ZIP bomb stops at the limit.
 */
export async function unpackPdfs(
  zipPath: string,
  dir: string,
  maxPdfBytes: number,
  maxTotalBytes: number,
): Promise<Unpacked> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, file) =>
      error || !file ? reject(new BadZip(error?.message ?? 'unreadable')) : resolve(file),
    ),
  );
  if (zip.entryCount > MAX_ZIP_ENTRIES) {
    zip.close();
    throw new BadZip(`more than ${MAX_ZIP_ENTRIES} entries`);
  }

  const result: Unpacked = { pdfs: [], skipped: [] };
  let total = 0;
  const open = (entry: yauzl.Entry) =>
    new Promise<Readable>((resolve, reject) =>
      zip.openReadStream(entry, (error, stream) =>
        error || !stream
          ? reject(new BadZip(error?.message ?? 'unreadable entry'))
          : resolve(stream),
      ),
    );

  await new Promise<void>((resolve, reject) => {
    zip.on('error', (error: Error) => reject(new BadZip(error.message)));
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName;
      const base = name.split('/').pop() ?? '';
      const next = () => zip.readEntry();
      if (name.endsWith('/') || base.startsWith('.') || name.startsWith('__MACOSX/')) {
        next();
        return;
      }
      if (!base.toLowerCase().endsWith('.pdf')) {
        result.skipped.push({ name, reason: 'not a PDF' });
        next();
        return;
      }
      if (entry.uncompressedSize > maxPdfBytes) {
        result.skipped.push({ name, reason: `larger than ${maxPdfBytes} bytes` });
        next();
        return;
      }
      total += entry.uncompressedSize;
      if (total > maxTotalBytes) {
        reject(new BadZip(`unpacks to more than ${maxTotalBytes} bytes`));
        return;
      }
      const path = join(dir, `${result.pdfs.length}.pdf`);
      open(entry)
        .then((stream) => saveAndHash(stream, path, maxPdfBytes))
        .then((file) => {
          if (file.isPdf) result.pdfs.push({ ...file, name });
          else result.skipped.push({ name, reason: 'not a PDF (no PDF signature)' });
          next();
        })
        .catch((error: unknown) => {
          if (error instanceof TooLarge) {
            result.skipped.push({ name, reason: error.message });
            next();
          } else {
            reject(error instanceof BadZip ? error : new BadZip(String(error)));
          }
        });
    });
    zip.readEntry();
  });
  return result;
}

/** A private temporary folder, removed with everything in it afterwards. */
export async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bc-import-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
