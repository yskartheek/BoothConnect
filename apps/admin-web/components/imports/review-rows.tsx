'use client';

import type { Schemas } from '@boothconnect/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { type MessageKey, t } from '@/lib/i18n';

import { errorMessage } from '../states';

export type ReviewRow = Schemas['ReviewRow'];
type Values = Record<string, unknown>;

/** Below this, a field was read with low confidence (the roll-parser's threshold). */
export const LOW_CONFIDENCE = 0.6;

type FieldKind = 'text' | 'number' | 'choice';
interface Field {
  key: string;
  label: MessageKey;
  kind: FieldKind;
  /** Choices (value → label); '' is "none" where the field can be empty. */
  choices?: [string, MessageKey][];
  /** Empty means null (no value), rather than "not changed". */
  nullable?: boolean;
}

/** The fields an admin can correct, in the order of the roll's voter box. */
export const FIELDS: Field[] = [
  { key: 'sectionNumber', label: 'imports.fieldSection', kind: 'number' },
  { key: 'epic', label: 'imports.fieldEpic', kind: 'text' },
  { key: 'name', label: 'imports.fieldName', kind: 'text' },
  {
    key: 'relationType',
    label: 'imports.fieldRelation',
    kind: 'choice',
    choices: [
      ['father', 'imports.relationFather'],
      ['mother', 'imports.relationMother'],
      ['husband', 'imports.relationHusband'],
      ['other', 'imports.relationOther'],
    ],
  },
  { key: 'relativeName', label: 'imports.fieldRelative', kind: 'text' },
  { key: 'houseNumber', label: 'imports.fieldHouse', kind: 'text', nullable: true },
  { key: 'age', label: 'imports.fieldAge', kind: 'number' },
  {
    key: 'gender',
    label: 'imports.fieldGender',
    kind: 'choice',
    choices: [
      ['male', 'imports.genderMale'],
      ['female', 'imports.genderFemale'],
      ['third_gender', 'imports.genderThird'],
    ],
  },
  {
    key: 'marker',
    label: 'imports.fieldMarker',
    kind: 'choice',
    nullable: true,
    choices: [
      ['', 'imports.markerNone'],
      ['deleted', 'imports.markerDeleted'],
      ['modified', 'imports.markerModified'],
    ],
  },
];

const shown = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

/** A field read below the threshold and not corrected since. */
export function isLowConfidence(row: ReviewRow, field: string): boolean {
  const confidence = row.confidence[field];
  return (
    typeof confidence === 'number' &&
    confidence < LOW_CONFIDENCE &&
    !(row.corrected && field in row.corrected)
  );
}

/** The value a choice field shows (its label), or the value itself. */
function display(field: Field, value: unknown): string {
  const choice = field.choices?.find(([v]) => v === (value ?? ''));
  return choice && choice[0] !== '' ? t(choice[1]) : shown(value);
}

/**
 * The fields the admin changed, as the API takes them: text trimmed,
 * numbers parsed, empty nullable fields null. Unchanged fields are left out.
 */
export function changedValues(current: Values, form: Record<string, string>): Values {
  const changes: Values = {};
  for (const field of FIELDS) {
    const raw = (form[field.key] ?? '').trim();
    const value =
      raw === ''
        ? field.nullable
          ? null
          : undefined
        : field.kind === 'number'
          ? Number(raw)
          : raw;
    if (value === undefined) continue;
    if (value !== (current[field.key] ?? null)) changes[field.key] = value;
  }
  return changes;
}

const ROW_STATUS: Record<ReviewRow['status'], MessageKey> = {
  accepted: 'imports.rowAccepted',
  warning: 'imports.rowWarning',
  rejected: 'imports.rowRejected',
};
const ROW_BADGE: Record<ReviewRow['status'], string> = {
  accepted: 'badge-create',
  warning: 'badge-update',
  rejected: 'badge-error',
};

/** One page of rows: serial, fields (low confidence marked), status and messages. */
export function RowsTable({
  rows,
  selected,
  onSelect,
}: {
  rows: ReviewRow[];
  selected: string | null;
  onSelect: (row: ReviewRow) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table review-table">
        <caption className="visually-hidden">{t('imports.rowsCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('imports.colSerial')}</th>
            {FIELDS.filter((f) => f.key !== 'sectionNumber').map((field) => (
              <th key={field.key} scope="col">
                {t(field.label)}
              </th>
            ))}
            <th scope="col">{t('imports.colStatus')}</th>
            <th scope="col">
              <span className="visually-hidden">{t('imports.colActions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} aria-selected={row.id === selected ? true : undefined}>
              <td>
                {row.sectionNo ?? '—'}/{row.serialNo ?? '—'}
              </td>
              {FIELDS.filter((f) => f.key !== 'sectionNumber').map((field) => {
                const low = isLowConfidence(row, field.key);
                const corrected = row.corrected !== null && field.key in row.corrected;
                return (
                  <td
                    key={field.key}
                    className={low ? 'low-confidence' : corrected ? 'corrected' : undefined}
                  >
                    {display(field, row.current[field.key])}
                    {low ? (
                      <span className="visually-hidden"> ({t('imports.lowConfidence')})</span>
                    ) : null}
                    {corrected ? (
                      <span className="visually-hidden"> ({t('imports.corrected')})</span>
                    ) : null}
                  </td>
                );
              })}
              <td>
                <span className={`badge ${ROW_BADGE[row.status]}`}>
                  {t(ROW_STATUS[row.status])}
                </span>
                <RowMessages row={row} />
              </td>
              <td>
                <button
                  type="button"
                  className="button button-quiet button-small"
                  aria-label={t('imports.correctLabel', {
                    serial: `${row.sectionNo ?? '—'}/${row.serialNo ?? '—'}`,
                  })}
                  onClick={() => onSelect(row)}
                >
                  {t('imports.correct')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowMessages({ row }: { row: ReviewRow }) {
  const open = row.messages.filter((m) => !m.resolved);
  if (open.length === 0) return null;
  return (
    <ul className="plain-list row-messages">
      {open.map((m, i) => (
        <li key={`${m.code}-${i}`} className={m.severity === 'error' ? 'form-error' : 'muted'}>
          {m.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Side-by-side correction (#73): the roll's page image next to the row's
 * fields. Only changed fields are sent; the extracted value stays on the row
 * and is shown under each field. The row can be rejected with a reason, or
 * the rejection taken back.
 */
export function CorrectionPanel({
  fileId,
  row,
  editable,
  pageSize,
  onClose,
}: {
  fileId: string;
  row: ReviewRow;
  editable: boolean;
  pageSize?: { width: number; height: number };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      FIELDS.map((f) => [
        f.key,
        row.current[f.key] === null || row.current[f.key] === undefined
          ? ''
          : String(row.current[f.key]),
      ]),
    ),
  );
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState<MessageKey | null>(null);
  const serial = `${row.sectionNo ?? '—'}/${row.serialNo ?? '—'}`;

  const change = useMutation({
    mutationFn: (body: Schemas['CorrectRowDto']) =>
      unwrap(
        apiClient().PATCH('/v1/imports/files/{id}/rows/{rowId}', {
          params: { path: { id: fileId, rowId: row.id } },
          body,
        }),
      ),
    onSuccess: async (_, body) => {
      setSaved(
        body.rejected === true
          ? 'imports.rowRejectedDone'
          : body.rejected === false
            ? 'imports.rowRestored'
            : 'imports.correctionSaved',
      );
      await queryClient.invalidateQueries({ queryKey: ['imports', 'file', fileId] });
      await queryClient.invalidateQueries({ queryKey: ['imports', 'batch'] });
    },
  });
  const changes = changedValues(row.current, form);
  const nothing = Object.keys(changes).length === 0;

  const save = (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    if (!nothing) change.mutate({ values: changes as Schemas['CorrectRowDto']['values'] });
  };

  return (
    <section className="glass section correction" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t('imports.correctTitle', { serial, page: row.page })}</h3>
      <div className="correction-grid">
        {/* It scrolls, so keyboard users can reach it (and scroll it) too. */}
        <figure
          className="page-image"
          tabIndex={0}
          aria-label={t('imports.pageImage', { page: row.page })}
        >
          {/* A voter page of the roll, served privately (no-store) through /api. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/imports/files/${encodeURIComponent(fileId)}/pages/${row.page}`}
            alt={t('imports.pageImage', { page: row.page })}
            width={pageSize?.width}
            height={pageSize?.height}
          />
          <figcaption className="muted">
            {t('imports.boxOnPage', { box: row.boxIndex + 1, page: row.page })}
          </figcaption>
        </figure>
        <form className="form" onSubmit={save} aria-label={t('imports.correctForm', { serial })}>
          {FIELDS.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={form[field.key] ?? ''}
              extracted={field.key === 'sectionNumber' ? row.sectionNo : row.extracted[field.key]}
              low={isLowConfidence(row, field.key)}
              disabled={!editable || row.status === 'rejected'}
              onChange={(value) => setForm((all) => ({ ...all, [field.key]: value }))}
            />
          ))}
          {row.correctedBy && row.correctedAt ? (
            <p className="muted">
              {t('imports.correctedBy', {
                name: row.correctedBy.name,
                date: new Date(row.correctedAt).toLocaleString('en-IN'),
              })}
            </p>
          ) : null}
          {change.isError ? (
            <p role="alert" className="form-error">
              {change.error instanceof ApiRequestError &&
              (change.error.status === 422 || change.error.status === 409)
                ? change.error.message
                : errorMessage(change.error)}
            </p>
          ) : saved ? (
            <p role="status" className="form-success">
              {t(saved)}
            </p>
          ) : null}
          {editable ? (
            <div className="form-actions">
              {row.status !== 'rejected' ? (
                <button type="submit" className="button" disabled={nothing || change.isPending}>
                  {t('imports.saveCorrection')}
                </button>
              ) : null}
              <button type="button" className="button button-quiet" onClick={onClose}>
                {t('imports.close')}
              </button>
            </div>
          ) : null}
        </form>
      </div>
      {editable ? (
        row.status === 'rejected' ? (
          <div className="form-actions">
            <button
              type="button"
              className="button button-quiet"
              disabled={change.isPending}
              onClick={() => change.mutate({ rejected: false })}
            >
              {t('imports.restoreRow')}
            </button>
          </div>
        ) : (
          <form
            className="form form-inline"
            onSubmit={(event) => {
              event.preventDefault();
              change.mutate({
                rejected: true,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              });
            }}
          >
            <label htmlFor={`${id}-reason`}>{t('imports.rejectReason')}</label>
            <input
              id={`${id}-reason`}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
            <button type="submit" className="button button-danger" disabled={change.isPending}>
              {t('imports.rejectRow')}
            </button>
          </form>
        )
      ) : null}
    </section>
  );
}

function FieldInput({
  field,
  value,
  extracted,
  low,
  disabled,
  onChange,
}: {
  field: Field;
  value: string;
  extracted: unknown;
  low: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={`correction-field${low ? ' low-confidence' : ''}`}>
      <label htmlFor={id}>
        {t(field.label)}
        {low ? <span className="badge badge-update">{t('imports.lowConfidence')}</span> : null}
      </label>
      {field.kind === 'choice' ? (
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-read`}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.choices!.some(([v]) => v === '') ? null : <option value="">—</option>}
          {field.choices!.map(([v, label]) => (
            <option key={v} value={v}>
              {t(label)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.kind === 'number' ? 'number' : 'text'}
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-read`}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <span id={`${id}-read`} className="form-hint">
        {t('imports.readAs', { value: display(field, extracted) })}
      </span>
    </div>
  );
}
