'use client';

import { newIdempotencyKey, type Schemas } from '@boothconnect/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { isMessageKey, type MessageKey, t } from '@/lib/i18n';

import { ErrorState, errorMessage, LoadingState } from '../states';

type Voter = Schemas['VoterDetail'];
type Field = Voter['fields'][number];
type Value = Field['current'][number];

/** Fields the roll also prints: the official column shows the roll's value. */
const OFFICIAL_KEY: Record<string, string> = { name: 'name', age: 'age', gender: 'gender' };

/** A field's label: `web.voter.field.<key>` when there is one, else the key. */
export function fieldLabel(key: string): string {
  const messageKey = `voter.field.${key}`;
  return isMessageKey(messageKey) ? t(messageKey) : key;
}

/** A value as shown: a choice by its label, anything else as text. */
export function valueText(field: Pick<Field, 'key' | 'type'>, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'single_select' || field.key === 'gender') {
    const messageKey = `voter.${field.key}.${String(value)}`;
    if (isMessageKey(messageKey)) return t(messageKey);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const SOURCE: Record<string, MessageKey> = {
  official_import: 'voter.sourceOfficial',
  voter_self_submitted: 'voter.sourceSelf',
  volunteer_collected: 'voter.sourceVolunteer',
  admin_corrected: 'voter.sourceAdmin',
  derived: 'voter.sourceDerived',
};

/** Who set a value, how and when: "Volunteer · Test Volunteer · 1 Feb 2026". */
export function provenance(value: Value): string {
  const parts = [
    t(SOURCE[value.sourceType] ?? 'voter.sourceVolunteer'),
    value.collectedBy?.name,
    new Date(value.collectedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }),
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * One voter (#75): the roll's official values next to the current ones, who
 * changed each and when, the history of each field, open conflicts, and
 * (for admins) corrections. Opening it is audited by the API.
 */
export function VoterRecord({ voterId }: { voterId: string }) {
  const voter = useQuery({
    queryKey: ['voters', voterId],
    queryFn: () =>
      unwrap(
        apiClient().GET('/v1/voters/{id}', {
          params: { path: { id: voterId }, query: { history: true } },
        }),
      ),
  });
  if (voter.isPending) return <LoadingState />;
  if (voter.isError) {
    if (voter.error instanceof ApiRequestError && [400, 404].includes(voter.error.status)) {
      return (
        <section className="glass section">
          <p role="alert">{t('voter.notFound')}</p>
          <p>
            <Link href="/voters">{t('voter.backToSearch')}</Link>
          </p>
        </section>
      );
    }
    return <ErrorState error={voter.error} onRetry={() => void voter.refetch()} />;
  }
  return <Record voter={voter.data} />;
}

function Record({ voter }: { voter: Voter }) {
  const id = useId();
  const official = (voter.official ?? {}) as Record<string, unknown>;
  const nameField = voter.fields.find((f) => f.key === 'name');
  const name = nameField?.current[0]?.value ?? official.name;
  const conflicts = voter.fields.filter((f) => f.current.length > 1);

  return (
    <>
      <p>
        <Link href="/voters">{t('voter.backToSearch')}</Link>
      </p>
      <section className="glass section" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>
          {typeof name === 'string' && name ? name : t('voter.unnamed')}{' '}
          {voter.origin === 'volunteer_added' ? (
            <span className="badge">{t('voter.addedByVolunteer')}</span>
          ) : null}
          {voter.recordStatus !== 'active' ? (
            <span className="badge">{t('voter.notActive')}</span>
          ) : null}
        </h2>
        <dl className="details">
          <div className="details-row">
            <dt>{t('voter.epic')}</dt>
            <dd>{voter.epicNumber ?? '—'}</dd>
          </div>
          <div className="details-row">
            <dt>{t('voter.sectionSerial')}</dt>
            <dd>
              {voter.sectionNo ?? '—'}/{voter.serialNo ?? '—'}
            </dd>
          </div>
          {['relationType', 'relativeName', 'houseNumber'].map((key) => (
            <div key={key} className="details-row">
              <dt>{fieldLabel(key)}</dt>
              <dd>{valueText({ key, type: 'text' }, official[key])}</dd>
            </div>
          ))}
          {voter.previousVoterIds.length > 0 ? (
            <div className="details-row">
              <dt>{t('voter.earlierRecords')}</dt>
              <dd>{t('voter.earlierRecordsCount', { count: voter.previousVoterIds.length })}</dd>
            </div>
          ) : null}
        </dl>
        {conflicts.length > 0 ? (
          <p role="alert" className="form-error">
            {t('voter.conflicts', { fields: conflicts.map((f) => fieldLabel(f.key)).join(', ') })}
          </p>
        ) : null}
      </section>

      <section className="glass section" aria-labelledby={`${id}-fields`}>
        <h2 id={`${id}-fields`}>{t('voter.fieldsTitle')}</h2>
        <div className="table-wrap">
          <table className="table voter-fields">
            <caption className="visually-hidden">{t('voter.fieldsCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('voter.colField')}</th>
                <th scope="col">{t('voter.colOfficial')}</th>
                <th scope="col">{t('voter.colCurrent')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('voter.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {voter.fields.map((field) => (
                <FieldRow key={field.key} voterId={voter.id} field={field} official={official} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass section" aria-labelledby={`${id}-visits`}>
        <h2 id={`${id}-visits`}>{t('voter.visitsTitle')}</h2>
        {voter.visitsMet.length === 0 ? (
          <p>{t('voter.noVisits')}</p>
        ) : (
          <ul className="plain-list">
            {voter.visitsMet.map((visit) => (
              <li key={visit.id}>
                {new Date(visit.startedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} ·{' '}
                {visit.volunteer.name} ·{' '}
                {isMessageKey(`visitOutcome.${visit.outcome}`)
                  ? t(`visitOutcome.${visit.outcome}` as MessageKey)
                  : visit.outcome}
                {visit.correctedById ? ` (${t('voter.visitCorrected')})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function FieldRow({
  voterId,
  field,
  official,
}: {
  voterId: string;
  field: Field;
  official: Record<string, unknown>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const officialKey = OFFICIAL_KEY[field.key];
  const history = field.history ?? [];
  const conflict = field.current.length > 1;

  return (
    <>
      <tr className={conflict ? 'field-conflict' : undefined}>
        <th scope="row">
          {fieldLabel(field.key)}
          {field.isRestricted ? <span className="badge">{t('voter.restricted')}</span> : null}
        </th>
        <td>{officialKey ? valueText(field, official[officialKey]) : t('voter.notOnRoll')}</td>
        <td>
          {field.current.length === 0 ? (
            <span className="muted">
              {officialKey && official[officialKey] !== undefined
                ? t('voter.asOnRoll')
                : t('voter.notSet')}
            </span>
          ) : (
            <ul className="plain-list">
              {conflict ? (
                <li>
                  <span className="badge badge-error">{t('voter.conflict')}</span>
                </li>
              ) : null}
              {field.current.map((value) => (
                <li key={value.id}>
                  <strong>{valueText(field, value.value)}</strong>
                  <span className="provenance"> {provenance(value)}</span>
                  {value.carriedFromId ? (
                    <span className="muted"> ({t('voter.carriedOver')})</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {editing ? (
            <CorrectField voterId={voterId} field={field} onDone={() => setEditing(false)} />
          ) : null}
        </td>
        <td className="field-actions">
          {history.length > 0 ? (
            <button
              type="button"
              className="button button-quiet button-small"
              aria-expanded={showHistory}
              aria-label={t('voter.historyLabel', {
                field: fieldLabel(field.key),
                count: history.length,
              })}
              onClick={() => setShowHistory(!showHistory)}
            >
              {t('voter.history', { count: history.length })}
            </button>
          ) : null}
          {!editing && !field.requiresConsent && !conflict ? (
            <button
              type="button"
              className="button button-quiet button-small"
              aria-label={t('voter.correctLabel', { field: fieldLabel(field.key) })}
              onClick={() => setEditing(true)}
            >
              {t('voter.correct')}
            </button>
          ) : null}
        </td>
      </tr>
      {showHistory ? (
        <tr className="field-history">
          <td colSpan={4}>
            <ol
              className="plain-list"
              aria-label={t('voter.historyOf', { field: fieldLabel(field.key) })}
            >
              {history.map((value) => (
                <li key={value.id}>
                  <s>{valueText(field, value.value)}</s>
                  <span className="provenance"> {provenance(value)}</span>
                </li>
              ))}
            </ol>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * An admin's correction of one field (PATCH /v1/voters/:id, audited). It is
 * based on the current value, so a change made meanwhile becomes a conflict
 * rather than being overwritten.
 */
function CorrectField({
  voterId,
  field,
  onDone,
}: {
  voterId: string;
  field: Field;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const current = field.current[0] ?? null;
  const [text, setText] = useState(
    current?.value === null || current?.value === undefined ? '' : String(current.value),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const options = Array.isArray(field.options)
    ? (field.options as { value: string }[]).filter((o) => typeof o?.value === 'string')
    : [];

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().PATCH('/v1/voters/{id}', {
          params: { path: { id: voterId }, header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: {
            fields: [
              {
                fieldKey: field.key,
                // Any JSON value; the API checks it against the field's type. (The
                // spec renders the DTO's \`unknown\` as an empty object type.)
                value: (field.type === 'number'
                  ? Number(text)
                  : text.trim()) as unknown as Schemas['MemberEditDto']['value'],
                baseVersion: current?.id ?? null,
              },
            ],
          },
        }),
      ),
    onSuccess: async (result) => {
      const outcome = result.fields[0];
      await queryClient.invalidateQueries({ queryKey: ['voters', voterId] });
      if (outcome?.status === 'rejected') setProblem(outcome.message);
      else if (outcome?.status === 'conflict') setProblem(t('voter.becameConflict'));
      else onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!text.trim()) return setProblem(t('voter.enterValue'));
    if (field.type === 'number' && !Number.isFinite(Number(text))) {
      return setProblem(t('voter.enterNumber'));
    }
    save.mutate();
  };

  return (
    <form className="form form-inline correct-field" onSubmit={submit} noValidate>
      <label htmlFor={id}>{t('voter.newValue', { field: fieldLabel(field.key) })}</label>
      {options.length > 0 ? (
        <select id={id} value={text} onChange={(event) => setText(event.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {valueText(field, o.value)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : field.type === 'phone' ? 'tel' : 'text'}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <button type="submit" className="button button-small" disabled={save.isPending}>
        {t('voter.save')}
      </button>
      <button type="button" className="button button-quiet button-small" onClick={onDone}>
        {t('voter.cancel')}
      </button>
      {problem || save.isError ? (
        <p role="alert" className="form-error">
          {problem ??
            (save.error instanceof ApiRequestError && save.error.status === 422
              ? save.error.message
              : errorMessage(save.error))}
        </p>
      ) : null}
    </form>
  );
}
