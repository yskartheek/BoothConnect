import type { Place } from '@/lib/geography';
import { t } from '@/lib/i18n';

export type FileKind = 'pdf' | 'zip';

/** The API's default limits; it checks the configured ones again. */
export const MAX_BYTES: Record<FileKind, number> = {
  pdf: 100 * 1024 * 1024,
  zip: 2 * 1024 * 1024 * 1024,
};

/** The API takes up to this many files per request for upload links. */
export const TICKETS_PER_REQUEST = 50;

export function kindOf(name: string): FileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** The content type to send, when the browser gives one the API accepts. */
export function contentTypeOf(file: File, kind: FileKind): string | undefined {
  const accepted =
    kind === 'pdf'
      ? ['application/pdf']
      : ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
  return accepted.includes(file.type) ? file.type : undefined;
}

export interface Checked {
  accepted: { file: File; kind: FileKind }[];
  problems: { name: string; reason: string }[];
}

/**
 * Which picked files can be uploaded at this level (design §3): at a Part,
 * exactly one PDF; at an AC, PC or State, any number of PDFs or ZIPs of
 * PDFs. `queued` are files already in the list or the batch.
 */
export function checkFiles(
  level: Place['type'],
  picked: File[],
  queued: { name: string; size: number }[],
): Checked {
  const result: Checked = { accepted: [], problems: [] };
  const seen = new Set(queued.map((f) => `${f.name}\u0000${f.size}`));
  const partLevel = level === 'part';
  let count = queued.length;
  for (const file of picked) {
    const kind = kindOf(file.name);
    const problem = (reason: string) => result.problems.push({ name: file.name, reason });
    if (!kind || (partLevel && kind !== 'pdf')) {
      problem(partLevel ? t('imports.onlyPdf') : t('imports.onlyPdfOrZip'));
    } else if (file.size === 0) {
      problem(t('imports.empty'));
    } else if (file.size > MAX_BYTES[kind]) {
      problem(t('imports.tooLarge', { max: megabytes(MAX_BYTES[kind]) }));
    } else if (seen.has(`${file.name}\u0000${file.size}`)) {
      problem(t('imports.alreadyListed'));
    } else if (partLevel && count >= 1) {
      problem(t('imports.onePdfAtPart'));
    } else {
      seen.add(`${file.name}\u0000${file.size}`);
      count += 1;
      result.accepted.push({ file, kind });
    }
  }
  return result;
}
