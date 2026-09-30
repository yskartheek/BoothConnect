'use client';

import type { Schemas } from '@boothconnect/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertDialog } from 'radix-ui';
import { useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { t } from '@/lib/i18n';

import { ErrorState, errorMessage, LoadingState } from '../states';
import { type Batch, importUrl } from './import-wizard';
import { FILE_STATUS, FileStatusBadge } from './upload-files';

type BatchFile = Batch['files'][number];
type FileStatus = BatchFile['status'];

/** Still being worked on: the page asks again every few seconds. */
const WORKING: FileStatus[] = ['uploaded', 'extracting', 'confirming'];
/** The order of the status filter. */
const STATUS_ORDER: FileStatus[] = [
  'extracting',
  'needs_review',
  'ready',
  'confirming',
  'confirmed',
  'rejected',
  'duplicate',
  'failed',
  'uploaded',
];
export const POLL_MS = 3000;
const PAGE = 50;

/** Files whose extraction has finished, one way or another. */
export const finishedCount = (files: BatchFile[]) =>
  files.filter((f) => f.status !== 'uploaded' && f.status !== 'extracting').length;

/** "Confirm all" confirms only the files that are ready. */
export const readyFiles = (files: BatchFile[]) => files.filter((f) => f.status === 'ready');

/**
 * Step 3 (#72): one row per file with its part, status, pages, voters,
 * quality and totals check. The page asks again every few seconds while
 * files are extracting or confirming. Rejected and failed files show why.
 * **Review** opens a file; **Confirm all ready files** confirms the rest.
 */
export function BatchProgress({ batchId }: { batchId: string }) {
  const id = useId();
  const batch = useQuery({
    queryKey: ['imports', 'batch', batchId],
    queryFn: () =>
      unwrap(apiClient().GET('/v1/imports/batches/{id}', { params: { path: { id: batchId } } })),
    refetchInterval: (query) =>
      query.state.data?.files.some((f) => WORKING.includes(f.status)) ? POLL_MS : false,
  });
  const [filter, setFilter] = useState<FileStatus | ''>('');
  const [shown, setShown] = useState(PAGE);

  if (batch.isPending) return <LoadingState />;
  if (batch.isError) return <ErrorState error={batch.error} onRetry={() => void batch.refetch()} />;

  const files = batch.data.files;
  const counts = batch.data.statusCounts;
  const finished = finishedCount(files);
  const working = files.some((f) => WORKING.includes(f.status));
  const rows = filter ? files.filter((f) => f.status === filter) : files;

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('imports.progressTitle')}</h2>
      {files.length === 0 ? (
        <p>
          {t('imports.noFiles')}{' '}
          <Link href={importUrl(batchId, 'upload')}>{t('imports.backToUpload')}</Link>
        </p>
      ) : (
        <>
          <div className="progress-summary">
            <label htmlFor={`${id}-overall`}>
              {t('imports.extracted', { done: finished, total: files.length })}
            </label>
            <progress id={`${id}-overall`} max={files.length} value={finished} />
            <p role="status" className="muted">
              {/* The label above isn't announced as it changes: say the count here too. */}
              <span className="visually-hidden">
                {t('imports.extracted', { done: finished, total: files.length })}.{' '}
              </span>
              {working ? t('imports.stillWorking') : t('imports.allFinished')}
            </p>
          </div>

          <div className="filters">
            <div className="filter">
              <label htmlFor={`${id}-status`}>{t('imports.show')}</label>
              <select
                id={`${id}-status`}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as FileStatus | '');
                  setShown(PAGE);
                }}
              >
                <option value="">{t('imports.allFiles', { count: files.length })}</option>
                {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                  <option key={s} value={s}>
                    {t('imports.statusCount', { status: t(FILE_STATUS[s]), count: counts[s]! })}
                  </option>
                ))}
              </select>
            </div>
            <ConfirmReady batchId={batchId} files={files} />
          </div>

          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">{t('imports.progressCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('imports.colFile')}</th>
                  <th scope="col">{t('imports.colPart')}</th>
                  <th scope="col">{t('imports.colStatus')}</th>
                  <th scope="col">{t('imports.colPages')}</th>
                  <th scope="col">{t('imports.colVoters')}</th>
                  <th scope="col">{t('imports.colQuality')}</th>
                  <th scope="col">{t('imports.colTotals')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('imports.colActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((file) => (
                  <FileRow key={file.id} batchId={batchId} file={file} />
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setShown((n) => n + PAGE)}
            >
              {t('imports.showMore', { count: rows.length - shown })}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function FileRow({ batchId, file }: { batchId: string; file: BatchFile }) {
  const part = file.part ?? file.proposedPart;
  const extracted = file.status !== 'uploaded' && file.status !== 'extracting';
  const reviewable = file.status === 'needs_review' || file.status === 'ready';
  return (
    <tr>
      <td>{file.originalName}</td>
      <td>
        {part ? `${part.code} ${part.name}` : '—'}
        {!file.part && file.proposedPart ? (
          <span className="badge badge-create">{t('imports.newPart')}</span>
        ) : null}
      </td>
      <td>
        <FileStatusBadge status={file.status} />
        {(file.status === 'rejected' || file.status === 'failed') && file.error ? (
          <p className="form-error file-reason">{file.error.message}</p>
        ) : null}
      </td>
      <td>{file.pageCount ?? '—'}</td>
      <td>{extracted && file.rowCount > 0 ? file.voterCount : '—'}</td>
      <td>{file.qualityScore === null ? '—' : `${Math.round(file.qualityScore * 100)}%`}</td>
      <td>
        <Totals match={extracted && file.rowCount > 0 ? file.totalsMatch : null} />
      </td>
      <td>
        {reviewable ? (
          <Link
            className="button button-quiet button-small"
            href={`${importUrl(batchId, 'review')}&file=${encodeURIComponent(file.id)}`}
            aria-label={t('imports.reviewLabel', { name: file.originalName })}
          >
            {t('imports.review')}
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

/** ✓ or ✗, with words for screen readers; — when not checked. */
function Totals({ match }: { match: boolean | null }) {
  if (match === null) {
    return (
      <span>
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">{t('imports.totalsUnknown')}</span>
      </span>
    );
  }
  return (
    <span className={match ? 'totals-ok' : 'totals-bad'}>
      <span aria-hidden="true">{match ? '✓' : '✗'}</span>
      <span className="visually-hidden">
        {match ? t('imports.totalsMatch') : t('imports.totalsDiffer')}
      </span>
    </span>
  );
}

/** "Confirm all ready files": only files in `ready` (POST /v1/imports/batches/:id/confirm). */
function ConfirmReady({ batchId, files }: { batchId: string; files: BatchFile[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Schemas['BatchConfirmResult'] | null>(null);
  const ready = readyFiles(files);
  const voters = ready.reduce((sum, f) => sum + f.voterCount, 0);
  const confirm = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().POST('/v1/imports/batches/{id}/confirm', {
          params: { path: { id: batchId } },
        }),
      ),
    onSuccess: async (confirmed) => {
      setResult(confirmed);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['imports', 'batch', batchId] });
    },
  });

  return (
    <div className="confirm-ready">
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) confirm.reset();
        }}
      >
        <AlertDialog.Trigger asChild>
          <button
            type="button"
            className="button"
            disabled={ready.length === 0}
            onClick={() => setResult(null)}
          >
            {t('imports.confirmReady', { count: ready.length })}
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog glass">
            <AlertDialog.Title>{t('imports.confirmReadyTitle')}</AlertDialog.Title>
            <AlertDialog.Description>
              {t('imports.confirmReadyMessage', { files: ready.length, voters })}
            </AlertDialog.Description>
            {confirm.isError ? (
              <p role="alert" className="form-error">
                {confirm.error instanceof ApiRequestError && confirm.error.status === 422
                  ? confirm.error.message
                  : errorMessage(confirm.error)}
              </p>
            ) : null}
            <div className="form-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="button button-quiet">
                  {t('imports.cancel')}
                </button>
              </AlertDialog.Cancel>
              <button
                type="button"
                className="button"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                {t('imports.confirmReady', { count: ready.length })}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {result ? (
        <div role="status" className="form-success">
          <p>{t('imports.confirmQueued', { count: result.queued.length })}</p>
          {result.skipped.length > 0 ? (
            <ul className="form-error">
              {result.skipped.map((s) => (
                <li key={s.id}>
                  {t('imports.confirmSkipped', {
                    name: files.find((f) => f.id === s.id)?.originalName ?? s.id,
                    reason: s.message,
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
