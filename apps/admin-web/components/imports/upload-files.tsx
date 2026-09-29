'use client';

import { newIdempotencyKey, type Schemas } from '@boothconnect/api-client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type DragEvent, useId, useRef, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { type MessageKey, t } from '@/lib/i18n';
import {
  PartFailedError,
  type PutPart,
  UploadExpiredError,
  type UploadTicket,
  uploadParts,
} from '@/lib/upload';

import { errorMessage } from '../states';
import type { Batch } from './import-wizard';
import { importUrl } from './import-wizard';
import { checkFiles, contentTypeOf, type FileKind, TICKETS_PER_REQUEST } from './upload-rules';

type UploadCompleted = Schemas['UploadCompleted'];
type FileStatus = Schemas['ImportedFile']['status'];

type ItemStatus = 'waiting' | 'uploading' | 'retrying' | 'processing' | 'done' | 'failed';

interface Item {
  key: string;
  file: File;
  kind: FileKind;
  status: ItemStatus;
  /** Bytes sent. */
  sent: number;
  error?: string;
  result?: UploadCompleted;
}

/** Files uploading at the same time. */
const PARALLEL = 3;

export const FILE_STATUS: Record<FileStatus, MessageKey> = {
  uploaded: 'imports.fileUploaded',
  extracting: 'imports.fileExtracting',
  needs_review: 'imports.fileNeedsReview',
  ready: 'imports.fileReady',
  confirming: 'imports.fileConfirming',
  confirmed: 'imports.fileConfirmed',
  rejected: 'imports.fileRejected',
  duplicate: 'imports.fileDuplicate',
  failed: 'imports.fileFailed',
};

const BADGE: Partial<Record<FileStatus, string>> = {
  duplicate: 'badge-info',
  rejected: 'badge-error',
  failed: 'badge-error',
  ready: 'badge-create',
  confirmed: 'badge-create',
};

/** A file's status; a duplicate says "Already imported", not an error. */
export function FileStatusBadge({ status }: { status: FileStatus }) {
  return <span className={`badge ${BADGE[status] ?? ''}`}>{t(FILE_STATUS[status])}</span>;
}

const percent = (item: Item) =>
  item.file.size === 0 ? 100 : Math.min(100, Math.round((item.sent / item.file.size) * 100));

/**
 * Step 2 (#71): add PDFs or ZIPs (dropped or picked), checked against the
 * level's rules, and upload them straight to storage in parts. Each file
 * shows its progress; a dropped connection is retried, and **Retry**
 * continues from the parts already sent.
 */
export function UploadFiles({ batch, put }: { batch: Batch; put?: PutPart }) {
  const queryClient = useQueryClient();
  const id = useId();
  const level = batch.targetNode.type;
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<{ name: string; reason: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const tickets = useRef(new Map<string, UploadTicket>());
  const sentParts = useRef(new Map<string, Map<number, string>>());
  const nextKey = useRef(0);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((all) => all.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const add = (picked: File[]) => {
    const queued = [
      ...batch.files.map((f) => ({ name: f.originalName, size: f.sizeBytes })),
      ...items.map((item) => ({ name: item.file.name, size: item.file.size })),
    ];
    const checked = checkFiles(level, picked, queued);
    setProblems(checked.problems);
    setItems((all) => [
      ...all,
      ...checked.accepted.map(({ file, kind }) => ({
        key: `f${(nextKey.current += 1)}`,
        file,
        kind,
        status: 'waiting' as const,
        sent: 0,
      })),
    ]);
  };

  const remove = (key: string) => setItems((all) => all.filter((item) => item.key !== key));

  /** Upload links for the files that have none, up to 50 per request. */
  const requestTickets = async (pending: Item[]) => {
    const need = pending.filter((item) => !tickets.current.has(item.key));
    for (let i = 0; i < need.length; i += TICKETS_PER_REQUEST) {
      const chunk = need.slice(i, i + TICKETS_PER_REQUEST);
      try {
        const { uploads } = await unwrap(
          apiClient().POST('/v1/imports/batches/{id}/files', {
            params: {
              path: { id: batch.id },
              header: { 'Idempotency-Key': newIdempotencyKey() },
            },
            body: {
              files: chunk.map(({ file, kind }) => ({
                name: file.name,
                sizeBytes: file.size,
                ...(contentTypeOf(file, kind) ? { contentType: contentTypeOf(file, kind) } : {}),
              })),
            },
          }),
        );
        chunk.forEach((item, j) => {
          tickets.current.set(item.key, uploads[j]!);
          sentParts.current.set(item.key, new Map());
        });
      } catch (error) {
        const message =
          error instanceof ApiRequestError && (error.status === 422 || error.status === 413)
            ? error.message
            : errorMessage(error);
        for (const item of chunk) update(item.key, { status: 'failed', error: message });
      }
    }
  };

  const uploadOne = async (item: Item) => {
    const ticket = tickets.current.get(item.key);
    if (!ticket) return;
    const done = sentParts.current.get(item.key)!;
    update(item.key, { status: 'uploading', error: undefined });
    try {
      const parts = await uploadParts(item.file, ticket, done, {
        ...(put ? { put } : {}),
        onProgress: (sent) => update(item.key, { sent, status: 'uploading' }),
        onRetry: () => update(item.key, { status: 'retrying' }),
      });
      update(item.key, { status: 'processing', sent: item.file.size });
      const result = await unwrap(
        apiClient().POST('/v1/imports/batches/{id}/files/{fileId}/complete', {
          params: { path: { id: batch.id, fileId: ticket.id } },
          body: { parts },
        }),
      );
      update(item.key, { status: 'done', result });
    } catch (error) {
      let message: string;
      if (error instanceof UploadExpiredError) {
        // New links next time.
        tickets.current.delete(item.key);
        message = t('imports.expired');
      } else if (error instanceof PartFailedError) {
        message = t('imports.partFailed');
      } else if (error instanceof ApiRequestError && error.status === 422) {
        if (error.details && typeof error.details === 'object' && 'reason' in error.details) {
          // Storage is missing a part: send them all again on the same links.
          done.clear();
        } else {
          // The upload failed for good (not a PDF, a bad ZIP…): a new one next time.
          tickets.current.delete(item.key);
        }
        message = error.message;
      } else {
        message = errorMessage(error);
      }
      update(item.key, { status: 'failed', error: message });
    }
  };

  const start = async (only?: Item[]) => {
    const pending = only ?? items.filter((i) => i.status === 'waiting' || i.status === 'failed');
    if (pending.length === 0) return;
    setRunning(true);
    try {
      await requestTickets(pending);
      const queue = pending.filter((item) => tickets.current.has(item.key));
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
          for (let item = queue.shift(); item; item = queue.shift()) await uploadOne(item);
        }),
      );
    } finally {
      setRunning(false);
      await queryClient.invalidateQueries({ queryKey: ['imports', 'batch', batch.id] });
    }
  };

  const waiting = items.filter((i) => i.status === 'waiting' || i.status === 'failed');
  const uploaded = items.some((i) => i.status === 'done') || batch.files.length > 0;
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    add([...event.dataTransfer.files]);
  };

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('imports.uploadTitle')}</h2>
      <p>{level === 'part' ? t('imports.partRule') : t('imports.manyRule')}</p>
      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>{t('imports.dropHere')}</p>
        <label htmlFor={`${id}-files`} className="button button-quiet">
          {level === 'part' ? t('imports.choosePdf') : t('imports.chooseFiles')}
        </label>
        <input
          id={`${id}-files`}
          className="visually-hidden"
          type="file"
          accept={
            level === 'part' ? '.pdf,application/pdf' : '.pdf,.zip,application/pdf,application/zip'
          }
          multiple={level !== 'part'}
          disabled={running}
          onChange={(event) => {
            add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>

      {problems.length > 0 ? (
        <div role="alert" className="form-error">
          <p>{t('imports.notAdded')}</p>
          <ul>
            {problems.map((p, i) => (
              <li key={`${p.name}-${i}`}>
                {p.name}: {p.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="upload-list" aria-label={t('imports.uploadList')}>
          {items.map((item) => (
            <UploadItem
              key={item.key}
              item={item}
              running={running}
              onRemove={() => remove(item.key)}
              onRetry={() => void start([item])}
            />
          ))}
        </ul>
      ) : null}

      <div className="form-actions">
        {waiting.length > 0 ? (
          <button type="button" className="button" disabled={running} onClick={() => void start()}>
            {t('imports.uploadCount', { count: waiting.length })}
          </button>
        ) : null}
        {uploaded && !running ? (
          <Link className="button button-quiet" href={importUrl(batch.id, 'extract')}>
            {t('imports.toExtract')}
          </Link>
        ) : null}
      </div>

      {batch.files.length > 0 ? <BatchFiles files={batch.files} /> : null}
    </section>
  );
}

const ITEM_STATUS: Record<ItemStatus, MessageKey> = {
  waiting: 'imports.itemWaiting',
  uploading: 'imports.itemUploading',
  retrying: 'imports.itemRetrying',
  processing: 'imports.itemProcessing',
  done: 'imports.itemDone',
  failed: 'imports.itemFailed',
};

function UploadItem({
  item,
  running,
  onRemove,
  onRetry,
}: {
  item: Item;
  running: boolean;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const id = useId();
  const busy =
    item.status === 'uploading' || item.status === 'retrying' || item.status === 'processing';
  return (
    <li className="upload-item">
      <div className="upload-item-head">
        <strong id={`${id}-name`}>{item.file.name}</strong>
        <span className="muted">{t(ITEM_STATUS[item.status])}</span>
        {item.status === 'waiting' && !running ? (
          <button
            type="button"
            className="button button-quiet button-small"
            aria-label={t('imports.removeLabel', { name: item.file.name })}
            onClick={onRemove}
          >
            {t('imports.remove')}
          </button>
        ) : null}
        {item.status === 'failed' && !running ? (
          <button
            type="button"
            className="button button-small"
            aria-label={t('imports.retryLabel', { name: item.file.name })}
            onClick={onRetry}
          >
            {t('imports.retry')}
          </button>
        ) : null}
      </div>
      {busy || item.status === 'done' ? (
        <progress
          max={100}
          value={percent(item)}
          aria-labelledby={`${id}-name`}
          aria-valuetext={`${percent(item)}%`}
        />
      ) : null}
      {item.error ? (
        <p role="alert" className="form-error">
          {item.error}
        </p>
      ) : null}
      {item.result ? <UploadResult result={item.result} /> : null}
    </li>
  );
}

/** What an upload became: its PDF (or the PDFs in the ZIP), and ZIP entries skipped. */
function UploadResult({ result }: { result: UploadCompleted }) {
  return (
    <ul className="plain-list upload-result">
      {result.files.map((file) => (
        <li key={file.id}>
          {file.originalName} <FileStatusBadge status={file.status} />
        </li>
      ))}
      {result.skipped.map((skipped, i) => (
        <li key={`skipped-${i}`} className="muted">
          {t('imports.skipped', { name: skipped.name, reason: skipped.reason })}
        </li>
      ))}
    </ul>
  );
}

function BatchFiles({ files }: { files: Batch['files'] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="table-caption">{t('imports.batchFiles')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('imports.colFile')}</th>
            <th scope="col">{t('imports.colStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id}>
              <td>{file.originalName}</td>
              <td>
                <FileStatusBadge status={file.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
