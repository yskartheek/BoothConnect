'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useId, useState } from 'react';

import { apiClient, unwrap } from '@/lib/api';
import { t } from '@/lib/i18n';

import { EmptyState, ErrorState, LoadingState } from '../states';
import { valueText } from './voter-record';

export const voterUrl = (id: string) => `/voters?voter=${encodeURIComponent(id)}`;

/**
 * Find a voter (#75): households of the admin's area by address, house
 * number, member name or EPIC (GET /v1/households?q=); open one to see its
 * members, and a member to see their record.
 */
export function VoterSearch() {
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const households = useQuery({
    queryKey: ['households', 'search', q],
    queryFn: () =>
      unwrap(apiClient().GET('/v1/households', { params: { query: { q, limit: 20 } } })),
    enabled: q.length > 0,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQ(text.trim());
  };

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('voter.searchTitle')}</h2>
      <form className="form form-inline" onSubmit={submit} role="search">
        <label htmlFor={`${id}-q`}>{t('voter.search')}</label>
        <input
          id={`${id}-q`}
          type="search"
          value={text}
          maxLength={100}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="button" disabled={!text.trim()}>
          {t('voter.find')}
        </button>
        <span id={`${id}-hint`} className="form-hint">
          {t('voter.searchHint')}
        </span>
      </form>
      {!q ? null : households.isPending ? (
        <LoadingState />
      ) : households.isError ? (
        <ErrorState error={households.error} onRetry={() => void households.refetch()} />
      ) : households.data.items.length === 0 ? (
        <EmptyState title={t('voter.noMatches')} />
      ) : (
        <ul className="plain-list household-results" aria-label={t('voter.results')}>
          {households.data.items.map((household) => (
            <HouseholdResult key={household.id} household={household} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HouseholdResult({
  household,
}: {
  household: { id: string; displayAddress: string; houseKey: string; voterCount: number };
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ['households', household.id],
    queryFn: () =>
      unwrap(apiClient().GET('/v1/households/{id}', { params: { path: { id: household.id } } })),
    enabled: open,
  });
  return (
    <li className="household-result">
      <button
        type="button"
        className="button button-quiet"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {household.displayAddress} · {t('voter.members', { count: household.voterCount })}
      </button>
      {open ? (
        detail.isPending ? (
          <LoadingState />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <ul className="plain-list member-list">
            {detail.data.members.map((member) => (
              <li key={member.id}>
                <Link href={voterUrl(member.id)}>{member.name ?? t('voter.unnamed')}</Link>{' '}
                <span className="muted">
                  {[
                    member.age ?? null,
                    member.gender
                      ? valueText({ key: 'gender', type: 'single_select' }, member.gender)
                      : null,
                    member.epicNumber,
                  ]
                    .filter((part) => part !== null && part !== '')
                    .join(' · ')}
                </span>
                {member.hasConflict ? (
                  <span className="badge badge-error">{t('voter.conflict')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}
