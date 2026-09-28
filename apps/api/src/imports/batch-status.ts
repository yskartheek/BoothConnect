import type { Prisma } from '../generated/prisma/client';

/**
 * A batch's status follows its files: `processing` while any file waits for
 * or is in extraction, then `review` while any is ready or needs review, then
 * `completed` once files are confirmed. A completed or cancelled batch is left
 * alone.
 */
export async function refreshBatchStatus(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<void> {
  const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status === 'completed' || batch.status === 'cancelled') return;
  const files = await tx.importFile.groupBy({
    by: ['status'],
    where: { batchId },
    _count: { _all: true },
  });
  const has = (...statuses: string[]) => files.some((f) => statuses.includes(f.status));
  const status = has('uploaded', 'extracting')
    ? 'processing'
    : has('ready', 'needs_review')
      ? 'review'
      : has('confirmed')
        ? 'completed'
        : // Only duplicates, rejections or failures: still open for the right files.
          'uploading';
  if (status !== batch.status)
    await tx.importBatch.update({ where: { id: batchId }, data: { status } });
}
