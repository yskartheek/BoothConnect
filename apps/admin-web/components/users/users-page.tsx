'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useDeferredValue, useId, useState } from 'react';

import { apiClient, unwrap } from '@/lib/api';
import { t } from '@/lib/i18n';

import { PageHeader } from '../page-header';
import { EmptyState, ErrorState, LoadingState } from '../states';
import { AddUser } from './add-user';
import { AreaPicker, type AreaNode, placeLabel } from './area-picker';
import { ROLE, type Role, type UserSummary } from './roles';
import { UserDetail } from './user-detail';

const ROLE_FILTERS: Role[] = ['admin', 'campaign_manager', 'volunteer'];
const PAGE_SIZE = 50;

interface Filters {
  path: AreaNode[];
  role: Role | '';
  q: string;
  activeOnly: boolean;
}

/**
 * Users and assignments (#176): the people of the admin's area, with filters;
 * one user's role history, where roles are given and ended; and adding a
 * user. The API shows only the admin's area, and the place pickers offer
 * only nodes in it.
 */
export function UsersPage() {
  const [filters, setFilters] = useState<Filters>({ path: [], role: '', q: '', activeOnly: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title={t('nav.users')}
        actions={
          adding ? null : (
            <button
              type="button"
              className="button"
              onClick={() => {
                setAdding(true);
                setNotice(null);
              }}
            >
              {t('users.addTitle')}
            </button>
          )
        }
      />
      {notice ? (
        <p role="status" className="form-success">
          {notice}
        </p>
      ) : null}
      {adding ? (
        <AddUser
          onCancel={() => setAdding(false)}
          onAdded={(result) => {
            setAdding(false);
            setNotice(
              t(result.created ? 'users.added' : 'users.addedExisting', { name: result.user.name }),
            );
            setSelected(result.user.id);
          }}
        />
      ) : null}
      {selected ? (
        <UserDetail key={selected} userId={selected} onClose={() => setSelected(null)} />
      ) : null}
      <UserList filters={filters} onFilters={setFilters} onOpen={setSelected} />
    </>
  );
}

function UserList({
  filters,
  onFilters,
  onOpen,
}: {
  filters: Filters;
  onFilters: (filters: Filters) => void;
  onOpen: (userId: string) => void;
}) {
  const id = useId();
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  // Typing doesn't wait for each keystroke's request.
  const q = useDeferredValue(filters.q.trim());
  const nodeId = filters.path.at(-1)?.id;
  const query = {
    ...(nodeId ? { nodeId } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(q ? { q } : {}),
    ...(filters.activeOnly ? { active: true } : {}),
    limit: PAGE_SIZE,
  };
  const users = useInfiniteQuery({
    queryKey: ['users', 'list', query],
    queryFn: ({ pageParam }) =>
      unwrap(
        apiClient().GET('/v1/users', {
          params: { query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = !!(nodeId || filters.role || q);

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('users.listTitle')}</h2>
      <div className="filters">
        <AreaPicker
          legend={t('users.filterPlace')}
          path={filters.path}
          emptyLabel={t('users.wholeArea')}
          onChange={(path) => set({ path })}
        />
        <div className="filter">
          <label htmlFor={`${id}-role`}>{t('users.role')}</label>
          <select
            id={`${id}-role`}
            value={filters.role}
            onChange={(event) => set({ role: event.target.value as Role | '' })}
          >
            <option value="">{t('users.anyRole')}</option>
            {ROLE_FILTERS.map((role) => (
              <option key={role} value={role}>
                {t(ROLE[role])}
              </option>
            ))}
          </select>
        </div>
        <div className="filter">
          <label htmlFor={`${id}-q`}>{t('users.search')}</label>
          <input
            id={`${id}-q`}
            type="search"
            value={filters.q}
            maxLength={100}
            onChange={(event) => set({ q: event.target.value })}
          />
        </div>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={filters.activeOnly}
            onChange={(event) => set({ activeOnly: event.target.checked })}
          />
          {t('users.activeOnly')}
        </label>
      </div>

      {users.isPending ? (
        <LoadingState />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={filtered ? t('users.noMatches') : t('users.empty')} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">{t('users.listCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('users.name')}</th>
                  <th scope="col">{t('users.phone')}</th>
                  <th scope="col">{t('users.colRoles')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('users.colActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <UserRow key={user.id} user={user} onOpen={() => onOpen(user.id)} />
                ))}
              </tbody>
            </table>
          </div>
          {users.hasNextPage ? (
            <button
              type="button"
              className="button button-quiet"
              disabled={users.isFetchingNextPage}
              onClick={() => void users.fetchNextPage()}
            >
              {t('users.more')}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function UserRow({ user, onOpen }: { user: UserSummary; onOpen: () => void }) {
  const active = user.assignments.filter((a) => a.active);
  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.phone}</td>
      <td>
        {active.length === 0 ? (
          <span className="muted">{t('users.noActiveRole')}</span>
        ) : (
          <ul className="plain-list">
            {active.map((a) => (
              <li key={a.id}>
                <strong>{t(ROLE[a.role])}</strong> · {placeLabel(a.node)}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        <button
          type="button"
          className="button button-quiet button-small"
          aria-label={t('users.openLabel', { name: user.name })}
          onClick={onOpen}
        >
          {t('users.open')}
        </button>
      </td>
    </tr>
  );
}
