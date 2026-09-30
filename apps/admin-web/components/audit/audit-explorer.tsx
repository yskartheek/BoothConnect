'use client';

import type { Schemas } from '@boothconnect/api-client';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { type FormEvent, useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { type MessageKey, t } from '@/lib/i18n';

import { EmptyState, ErrorState, errorMessage, LoadingState } from '../states';
import { apiQuery, type AuditFilters, filtersToSearch } from './filters';

type AuditEvent = Schemas['AuditEventView'];
type ChainCheck = NonNullable<Schemas['AuditEventsPage']['verification']>;

const PAGE = 50;

const RESULT: Record<string, MessageKey> = {
  success: 'audit.resultSuccess',
  failure: 'audit.resultFailure',
  denied: 'audit.resultDenied',
};
const RESULT_BADGE: Record<string, string> = {
  success: 'badge-create',
  failure: 'badge-error',
  denied: 'badge-update',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });

/**
 * The audit explorer (#76): the audit log filtered by actor, action,
 * resource and date (filters kept in the address), newest first with
 * paging, one event's details (metadata as the API redacted it), and a
 * check of the hash chain. Every read is itself audited by the API.
 */
export function AuditExplorer({ initial }: { initial: AuditFilters }) {
  const router = useRouter();
  const [draft, setDraft] = useState<AuditFilters>(initial);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const query = apiQuery(initial);

  const events = useInfiniteQuery({
    queryKey: ['audit', query],
    queryFn: ({ pageParam }) =>
      unwrap(
        apiClient().GET('/v1/audit-events', {
          params: { query: { ...query, limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const apply = (event: FormEvent) => {
    event.preventDefault();
    router.replace(`/audit${filtersToSearch(draft)}`);
  };
  const rows = events.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <Filters
        draft={draft}
        onChange={setDraft}
        onSubmit={apply}
        onClear={() => router.replace('/audit')}
      />
      <Verify filters={initial} />
      <section className="glass section" aria-labelledby="audit-events">
        <h2 id="audit-events">{t('audit.eventsTitle')}</h2>
        {events.isPending ? (
          <LoadingState />
        ) : events.isError ? (
          events.error instanceof ApiRequestError && events.error.status === 400 ? (
            <p role="alert" className="form-error">
              {t('audit.badFilter', { reason: validationReason(events.error) })}
            </p>
          ) : (
            <ErrorState error={events.error} onRetry={() => void events.refetch()} />
          )
        ) : rows.length === 0 ? (
          <EmptyState title={t('audit.noEvents')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table audit-table">
                <caption className="visually-hidden">{t('audit.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('audit.colTime')}</th>
                    <th scope="col">{t('audit.colAction')}</th>
                    <th scope="col">{t('audit.colActor')}</th>
                    <th scope="col">{t('audit.colResource')}</th>
                    <th scope="col">{t('audit.colResult')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('audit.colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((event) => (
                    <tr key={event.id}>
                      <td>{when(event.at)}</td>
                      <td>
                        <code>{event.action}</code>
                      </td>
                      <td>{event.actor?.name ?? t('audit.system')}</td>
                      <td>
                        {event.resourceType}
                        {event.resourceId ? (
                          <span className="muted"> · {shortId(event.resourceId)}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`badge ${RESULT_BADGE[event.result] ?? ''}`}>
                          {t(RESULT[event.result] ?? 'audit.resultSuccess')}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          aria-label={t('audit.openLabel', {
                            action: event.action,
                            seq: event.seq,
                          })}
                          onClick={() => setSelected(event)}
                        >
                          {t('audit.open')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {events.hasNextPage ? (
              <button
                type="button"
                className="button button-quiet"
                disabled={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                {t('audit.more')}
              </button>
            ) : null}
          </>
        )}
      </section>
      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** The API's reasons for a refused filter: each field's errors, or its message. */
export function validationReason(error: ApiRequestError): string {
  const details = Array.isArray(error.details) ? (error.details as { errors?: unknown }[]) : [];
  const reasons = details.flatMap((d) =>
    Array.isArray(d.errors) ? d.errors.filter((e): e is string => typeof e === 'string') : [],
  );
  return reasons.length > 0 ? reasons.join('; ') : error.message;
}

/** Long ids read better shortened; the drawer has the full one. */
export const shortId = (id: string) => (id.length > 13 ? `${id.slice(0, 8)}…` : id);

function Filters({
  draft,
  onChange,
  onSubmit,
  onClear,
}: {
  draft: AuditFilters;
  onChange: (filters: AuditFilters) => void;
  onSubmit: (event: FormEvent) => void;
  onClear: () => void;
}) {
  const id = useId();
  const users = useQuery({
    queryKey: ['users', 'list', { limit: 100 }],
    queryFn: () => unwrap(apiClient().GET('/v1/users', { params: { query: { limit: 100 } } })),
  });
  const set = (patch: Partial<AuditFilters>) => onChange({ ...draft, ...patch });
  const text = (
    key: 'action' | 'resourceType' | 'resourceId',
    label: MessageKey,
    hint?: MessageKey,
  ) => (
    <div className="filter">
      <label htmlFor={`${id}-${key}`}>{t(label)}</label>
      <input
        id={`${id}-${key}`}
        value={draft[key] ?? ''}
        maxLength={200}
        aria-describedby={hint ? `${id}-${key}-hint` : undefined}
        onChange={(event) => set({ [key]: event.target.value })}
      />
      {hint ? (
        <span id={`${id}-${key}-hint`} className="form-hint">
          {t(hint)}
        </span>
      ) : null}
    </div>
  );

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('audit.filtersTitle')}</h2>
      <form className="filters" onSubmit={onSubmit}>
        <div className="filter">
          <label htmlFor={`${id}-actor`}>{t('audit.actor')}</label>
          <select
            id={`${id}-actor`}
            value={draft.actor ?? ''}
            onChange={(event) => set({ actor: event.target.value })}
          >
            <option value="">{t('audit.anyone')}</option>
            {(users.data?.items ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
        {text('action', 'audit.action', 'audit.actionHint')}
        {text('resourceType', 'audit.resourceType', 'audit.resourceTypeHint')}
        {text('resourceId', 'audit.resourceId')}
        <div className="filter">
          <label htmlFor={`${id}-result`}>{t('audit.result')}</label>
          <select
            id={`${id}-result`}
            value={draft.result ?? ''}
            onChange={(event) => set({ result: event.target.value })}
          >
            <option value="">{t('audit.anyResult')}</option>
            {Object.entries(RESULT).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter">
          <label htmlFor={`${id}-from`}>{t('audit.from')}</label>
          <input
            id={`${id}-from`}
            type="date"
            value={draft.from ?? ''}
            onChange={(event) => set({ from: event.target.value })}
          />
        </div>
        <div className="filter">
          <label htmlFor={`${id}-to`}>{t('audit.to')}</label>
          <input
            id={`${id}-to`}
            type="date"
            value={draft.to ?? ''}
            onChange={(event) => set({ to: event.target.value })}
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="button">
            {t('audit.apply')}
          </button>
          <button type="button" className="button button-quiet" onClick={onClear}>
            {t('audit.clear')}
          </button>
        </div>
      </form>
    </section>
  );
}

/** "Verify chain": the API re-checks the hash chain over the date range (`verify=true`). */
function Verify({ filters }: { filters: AuditFilters }) {
  const range = apiQuery({ from: filters.from, to: filters.to });
  const verify = useMutation({
    mutationFn: async () => {
      const page = await unwrap(
        apiClient().GET('/v1/audit-events', {
          params: { query: { ...range, verify: true, limit: 1 } },
        }),
      );
      return page.verification as ChainCheck;
    },
  });
  const scope =
    filters.from || filters.to
      ? t('audit.verifyRange', { from: filters.from ?? '…', to: filters.to ?? '…' })
      : t('audit.verifyAll');
  return (
    <section className="glass section verify" aria-labelledby="audit-verify">
      <h2 id="audit-verify">{t('audit.verifyTitle')}</h2>
      <p className="muted">{scope}</p>
      <div className="form-actions">
        <button
          type="button"
          className="button"
          disabled={verify.isPending}
          onClick={() => verify.mutate()}
        >
          {t('audit.verify')}
        </button>
      </div>
      <div aria-live="polite">
        {verify.isPending ? (
          <p>{t('audit.verifying')}</p>
        ) : verify.isError ? (
          <p role="alert" className="form-error">
            {errorMessage(verify.error)}
          </p>
        ) : verify.data ? (
          verify.data.intact ? (
            <p className="form-success">
              <span aria-hidden="true">✓ </span>
              {t('audit.intact', { count: verify.data.checked })}
            </p>
          ) : (
            <p role="alert" className="form-error">
              <span aria-hidden="true">✗ </span>
              {t('audit.broken', {
                seq: verify.data.firstBrokenSeq ?? '?',
                count: verify.data.checked,
              })}
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}

/** One event, everything the API returns about it (metadata already redacted). */
function EventDrawer({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  return (
    <Dialog.Root open={event !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="drawer glass" aria-describedby={undefined}>
          {event ? (
            <>
              <Dialog.Title>{event.action}</Dialog.Title>
              <dl className="details">
                {(
                  [
                    ['audit.colTime', when(event.at)],
                    ['audit.colResult', t(RESULT[event.result] ?? 'audit.resultSuccess')],
                    [
                      'audit.colActor',
                      event.actor ? `${event.actor.name} (${event.actor.id})` : t('audit.system'),
                    ],
                    ['audit.resourceType', event.resourceType],
                    ['audit.resourceId', event.resourceId ?? '—'],
                    ['audit.seq', event.seq],
                    ['audit.session', event.sessionId ?? '—'],
                    ['audit.request', event.requestId ?? '—'],
                  ] as [MessageKey, string][]
                ).map(([label, value]) => (
                  <div key={label} className="details-row">
                    <dt>{t(label)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <h3>{t('audit.metadata')}</h3>
              <p className="form-hint">{t('audit.redacted')}</p>
              <pre className="metadata" tabIndex={0} aria-label={t('audit.metadata')}>
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
              <details>
                <summary>{t('audit.hashes')}</summary>
                <dl className="details hashes">
                  <div className="details-row">
                    <dt>{t('audit.hash')}</dt>
                    <dd>
                      <code>{event.hash}</code>
                    </dd>
                  </div>
                  <div className="details-row">
                    <dt>{t('audit.prevHash')}</dt>
                    <dd>
                      <code>{event.prevHash ?? '—'}</code>
                    </dd>
                  </div>
                </dl>
              </details>
              <div className="form-actions">
                <Dialog.Close asChild>
                  <button type="button" className="button button-quiet">
                    {t('audit.close')}
                  </button>
                </Dialog.Close>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
