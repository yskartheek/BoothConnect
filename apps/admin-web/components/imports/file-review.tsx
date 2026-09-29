'use client';

import type { Schemas } from '@boothconnect/api-client';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertDialog } from 'radix-ui';
import { useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { type MessageKey, t } from '@/lib/i18n';

import { ErrorState, errorMessage, LoadingState } from '../states';
import { POLL_MS } from './batch-progress';
import { importUrl } from './import-wizard';
import { CorrectionPanel, type ReviewRow, RowsTable } from './review-rows';
import { FileStatusBadge } from './upload-files';

type Preview = Schemas['FilePreview'];
type RowFilter = '' | 'warning' | 'rejected' | 'accepted';
const PAGE = 50;

/** Review, correction and confirm happen only in these statuses. */
const REVIEWABLE: Preview['file']['status'][] = ['needs_review', 'ready'];

/** Cover-page details worth showing, in order, when the roll has them. */
const HEADER_FIELDS: [string, MessageKey][] = [
  ['rollIdentification', 'imports.headerRoll'],
  ['revisionType', 'imports.headerRevision'],
  ['revisionYear', 'imports.headerYear'],
  ['qualifyingDate', 'imports.headerQualifying'],
  ['publicationDate', 'imports.headerPublished'],
  ['acNumber', 'imports.headerAc'],
  ['acName', 'imports.headerAcName'],
  ['pcNumber', 'imports.headerPc'],
  ['partNumber', 'imports.headerPart'],
  ['mainTown', 'imports.headerTown'],
  ['district', 'imports.headerDistrict'],
];

const COUNTS: [keyof Schemas['TotalsCheck']['current'], MessageKey][] = [
  ['male', 'imports.men'],
  ['female', 'imports.women'],
  ['thirdGender', 'imports.thirdGender'],
  ['total', 'imports.total'],
];

/**
 * Steps 4–5 (#73) for one file: the header and what confirm will create or
 * update, the totals check, the rows (filtered, paged, low-confidence fields
 * marked) with side-by-side correction, the rejections CSV, and confirm.
 */
export function FileReview({ batchId, fileId }: { batchId: string; fileId: string }) {
  const id = useId();
  const [status, setStatus] = useState<RowFilter>('');
  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const query = {
    ...(status ? { status: [status] } : {}),
    ...(lowOnly ? { lowConfidence: true } : {}),
    limit: PAGE,
  };
  const preview = useInfiniteQuery({
    queryKey: ['imports', 'file', fileId, query],
    queryFn: ({ pageParam }) =>
      unwrap(
        apiClient().GET('/v1/imports/files/{id}/preview', {
          params: {
            path: { id: fileId },
            query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.rows.nextCursor ?? undefined,
    // While the file is being committed, ask again until it's done.
    refetchInterval: (q) =>
      q.state.data?.pages[0]?.file.status === 'confirming' ? POLL_MS : false,
  });

  if (preview.isPending) return <LoadingState />;
  if (preview.isError) {
    if (preview.error instanceof ApiRequestError && preview.error.status === 404) {
      return (
        <section className="glass section">
          <p role="alert">{t('imports.fileNotFound')}</p>
          <p>
            <Link href={importUrl(batchId, 'extract')}>{t('imports.backToProgress')}</Link>
          </p>
        </section>
      );
    }
    return <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />;
  }

  const first = preview.data.pages[0]!;
  const file = first.file;
  const rows = preview.data.pages.flatMap((page) => page.rows.items);
  // The selected row as last loaded (after a correction, the refetched one).
  const current = selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null;
  const editable = REVIEWABLE.includes(file.status);

  return (
    <>
      <section className="glass section" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>
          {t('imports.reviewTitle', { name: file.originalName })}{' '}
          <FileStatusBadge status={file.status} />
        </h2>
        <p>
          <Link href={importUrl(batchId, 'extract')}>{t('imports.backToProgress')}</Link>
        </p>
        <WhatChanges preview={first} />
        <Totals totals={first.totals} />
        {first.issues.length > 0 ? (
          <ul className="plain-list">
            {first.issues.map((issue, i) => (
              <li
                key={`${issue.code}-${i}`}
                className={issue.severity === 'error' ? 'form-error' : 'muted'}
              >
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        <ConfirmFile batchId={batchId} preview={first} />
      </section>

      <section className="glass section" aria-labelledby={`${id}-rows`}>
        <h2 id={`${id}-rows`}>{t('imports.rowsTitle', { count: first.rows.total })}</h2>
        <div className="filters">
          <div className="filter">
            <label htmlFor={`${id}-status`}>{t('imports.rowFilter')}</label>
            <select
              id={`${id}-status`}
              value={status}
              onChange={(event) => setStatus(event.target.value as RowFilter)}
            >
              <option value="">{t('imports.rowsAll')}</option>
              <option value="warning">{t('imports.rowWarning')}</option>
              <option value="rejected">{t('imports.rowRejected')}</option>
              <option value="accepted">{t('imports.rowAccepted')}</option>
            </select>
          </div>
          <label className="filter-check">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(event) => setLowOnly(event.target.checked)}
            />
            {t('imports.lowOnly')}
          </label>
          <a
            className="button button-quiet"
            href={`/api/v1/imports/files/${encodeURIComponent(fileId)}/rejections.csv`}
            download
          >
            {t('imports.rejectionsCsv')}
          </a>
        </div>
        {current ? (
          <CorrectionPanel
            // Per row: after a save the panel stays, with its message.
            key={current.id}
            fileId={fileId}
            row={current}
            editable={editable}
            pageSize={first.pages.find((p) => p.page === current.page)}
            onClose={() => setSelected(null)}
          />
        ) : null}
        {rows.length === 0 ? (
          <p>{t('imports.noRows')}</p>
        ) : (
          <RowsTable rows={rows} selected={current?.id ?? null} onSelect={setSelected} />
        )}
        {preview.hasNextPage ? (
          <button
            type="button"
            className="button button-quiet"
            disabled={preview.isFetchingNextPage}
            onClick={() => void preview.fetchNextPage()}
          >
            {t('imports.moreRows')}
          </button>
        ) : null}
      </section>
    </>
  );
}

/** The part and stations confirm will create or update, and the cover page as read. */
function WhatChanges({ preview }: { preview: Preview }) {
  const { file, header, stations } = preview;
  const part = file.part ?? file.proposedPart;
  return (
    <div className="what-changes">
      <h3>{t('imports.whatChanges')}</h3>
      <ul className="plain-list">
        <li>
          {part
            ? t(file.part ? 'imports.partUpdated' : 'imports.partCreated', {
                part: `${part.code} ${part.name}`,
              })
            : t('imports.partUnknown')}
        </li>
        {stations.map((station) => (
          <li key={station.code}>
            {t(station.nodeId ? 'imports.stationKept' : 'imports.stationCreated', {
              station: `${station.code} ${station.name}`,
            })}
            {station.auxiliary ? <span className="badge">{t('geography.auxiliary')}</span> : null}
          </li>
        ))}
        {preview.previousSourceVersionId ? <li>{t('imports.newRevision')}</li> : null}
      </ul>
      {header ? (
        <dl className="details">
          {HEADER_FIELDS.filter(([key]) => header[key] !== undefined && header[key] !== null).map(
            ([key, label]) => (
              <div key={key} className="details-row">
                <dt>{t(label)}</dt>
                <dd>{String(header[key])}</dd>
              </div>
            ),
          )}
        </dl>
      ) : null}
    </div>
  );
}

/** Printed vs extracted vs now, by gender, and whether they match. */
function Totals({ totals }: { totals: Schemas['TotalsCheck'] }) {
  return (
    <div className="table-wrap">
      <table className="table totals-table">
        <caption className="table-caption">
          {t('imports.totalsTitle')}{' '}
          <span className={totals.matches ? 'totals-ok' : 'totals-bad'}>
            {totals.matches ? t('imports.totalsMatch') : t('imports.totalsDiffer')}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{t('imports.colCount')}</span>
            </th>
            <th scope="col">{t('imports.printed')}</th>
            <th scope="col">{t('imports.extractedCol')}</th>
            <th scope="col">{t('imports.now')}</th>
            <th scope="col">{t('imports.difference')}</th>
          </tr>
        </thead>
        <tbody>
          {COUNTS.map(([key, label]) => {
            const diff = totals.difference?.[key];
            return (
              <tr key={key}>
                <th scope="row">{t(label)}</th>
                <td>{totals.printed?.[key] ?? '—'}</td>
                <td>{totals.extracted?.[key] ?? '—'}</td>
                <td>{totals.current[key]}</td>
                <td className={diff ? 'totals-bad' : undefined}>
                  {diff === undefined || diff === null ? '—' : diff > 0 ? `+${diff}` : diff}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Confirm this file: a dialog states how many voters and households will be
 * committed; a totals mismatch has to be acknowledged. While it commits the
 * page follows it, then links to the part's analytics.
 */
function ConfirmFile({ batchId, preview }: { batchId: string; preview: Preview }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [acceptMismatch, setAcceptMismatch] = useState(false);
  const { file, totals, willCommit } = preview;
  const part = file.part ?? file.proposedPart;
  const confirm = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().POST('/v1/imports/files/{id}/confirm', {
          params: { path: { id: file.id } },
          body: totals.matches ? {} : { acceptTotalsMismatch: acceptMismatch },
        }),
      ),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
      router.replace(`${importUrl(batchId, 'confirm')}&file=${encodeURIComponent(file.id)}`);
    },
  });

  if (file.status === 'confirming') {
    return (
      <div role="status" className="confirm-progress">
        <progress aria-label={t('imports.committing')} />
        <p>{t('imports.committing')}</p>
      </div>
    );
  }
  if (file.status === 'confirmed') {
    return (
      <div role="status" className="form-success">
        <p>{t('imports.committed', { voters: file.voterCount })}</p>
        {file.part ? (
          <p>
            <Link href={`/analytics?node=${encodeURIComponent(file.part.id)}`}>
              {t('imports.partAnalytics', { part: `${file.part.code} ${file.part.name}` })}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }
  if (!REVIEWABLE.includes(file.status)) return null;

  return (
    <div className="confirm-file">
      {willCommit ? null : <p className="form-error">{t('imports.fixRowsFirst')}</p>}
      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            confirm.reset();
            setAcceptMismatch(false);
          }
        }}
      >
        <AlertDialog.Trigger asChild>
          <button type="button" className="button" disabled={!willCommit}>
            {t('imports.confirmFile')}
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog glass">
            <AlertDialog.Title>{t('imports.confirmFileTitle')}</AlertDialog.Title>
            <AlertDialog.Description>
              {t('imports.confirmFileMessage', {
                voters: willCommit?.voters ?? 0,
                households: willCommit?.households ?? 0,
                part: part ? `${part.code} ${part.name}` : '—',
              })}
            </AlertDialog.Description>
            {totals.matches ? null : (
              <label className="filter-check" htmlFor={`${id}-mismatch`}>
                <input
                  id={`${id}-mismatch`}
                  type="checkbox"
                  checked={acceptMismatch}
                  onChange={(event) => setAcceptMismatch(event.target.checked)}
                />
                {t('imports.acceptMismatch')}
              </label>
            )}
            {confirm.isError ? (
              <p role="alert" className="form-error">
                {confirm.error instanceof ApiRequestError &&
                (confirm.error.status === 422 || confirm.error.status === 409)
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
                disabled={confirm.isPending || (!totals.matches && !acceptMismatch)}
                onClick={() => confirm.mutate()}
              >
                {t('imports.confirmFile')}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
