'use client';

import { newIdempotencyKey } from '@boothconnect/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useMemo, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { allChildren, LEVEL, type Place } from '@/lib/geography';
import { t } from '@/lib/i18n';

import { EmptyState, ErrorState, errorMessage, LoadingState } from '../states';

export type { Place };
export interface MasterNode extends Place {
  children: MasterNode[];
}

/** The States, PCs and ACs the admin can see, as a tree. */
async function loadMasterTree(): Promise<MasterNode[]> {
  const build = async (parentId: string | null): Promise<MasterNode[]> => {
    const places = await allChildren(parentId);
    return Promise.all(
      places.map(async (place) => ({
        ...place,
        children: place.type === 'state' || place.type === 'pc' ? await build(place.id) : [],
      })),
    );
  };
  return build(null);
}

/** Nodes that match (code prefix or part of the name), with the path down to them. */
export function filterTree(nodes: MasterNode[], search: string): MasterNode[] {
  const q = search.trim().toLowerCase();
  if (!q) return nodes;
  return nodes.flatMap((node) => {
    const matches = node.code.toLowerCase().startsWith(q) || node.name.toLowerCase().includes(q);
    if (matches) return [node];
    const children = filterTree(node.children, q);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

/**
 * The current State → PC → AC hierarchy (#103), with search and inline edits
 * of a name or reservation. Parts and polling stations come from roll imports
 * and are shown read-only.
 */
export function GeographyTree() {
  const searchId = useId();
  const [search, setSearch] = useState('');
  const tree = useQuery({ queryKey: ['geography', 'master'], queryFn: loadMasterTree });
  const shown = useMemo(() => filterTree(tree.data ?? [], search), [tree.data, search]);

  return (
    <section className="glass section" aria-labelledby={`${searchId}-title`}>
      <h2 id={`${searchId}-title`}>{t('geography.treeTitle')}</h2>
      <div className="form form-inline">
        <label htmlFor={searchId}>{t('geography.search')}</label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {tree.isPending ? (
        <LoadingState />
      ) : tree.isError ? (
        <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
      ) : tree.data.length === 0 ? (
        <EmptyState title={t('geography.empty')} />
      ) : shown.length === 0 ? (
        <p>{t('geography.noMatches')}</p>
      ) : (
        <ul className="tree">
          {shown.map((node) => (
            <MasterItem key={node.id} node={node} open={search.trim() !== ''} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PlaceLabel({ place }: { place: Place }) {
  return (
    <span className="tree-label">
      <span className="tree-level">{t(LEVEL[place.type])}</span>
      <strong>{place.code}</strong> {place.name}
      {place.reservation ? <span className="badge">{place.reservation}</span> : null}
      {place.isAuxiliary ? <span className="badge">{t('geography.auxiliary')}</span> : null}
    </span>
  );
}

function MasterItem({ node, open }: { node: MasterNode; open: boolean }) {
  // States and PCs start open; ACs open to show their parts.
  const [expanded, setExpanded] = useState(node.type !== 'ac');
  const [editing, setEditing] = useState(false);
  const isOpen = expanded || (open && node.children.length > 0);
  const hasChildren = node.type === 'ac' || node.children.length > 0;

  return (
    <li>
      <div className="tree-row">
        {hasChildren ? (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={isOpen}
            aria-label={`${t(LEVEL[node.type])} ${node.code} ${node.name}`}
            onClick={() => setExpanded(!isOpen)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-toggle" aria-hidden="true" />
        )}
        {editing ? (
          <EditPlace place={node} onDone={() => setEditing(false)} />
        ) : (
          <>
            <PlaceLabel place={node} />
            <button
              type="button"
              className="button button-quiet button-small"
              aria-label={`${t('geography.edit')} ${node.code} ${node.name}`}
              onClick={() => setEditing(true)}
            >
              {t('geography.edit')}
            </button>
          </>
        )}
      </div>
      {isOpen ? (
        node.type === 'ac' ? (
          <RollPlaces parentId={node.id} />
        ) : (
          <ul className="tree">
            {node.children.map((child) => (
              <MasterItem key={child.id} node={child} open={open} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

/** Parts under an AC, or stations under a part: read-only, loaded when opened. */
function RollPlaces({ parentId }: { parentId: string }) {
  const places = useQuery({
    queryKey: ['geography', 'children', parentId],
    queryFn: () => allChildren(parentId),
  });
  if (places.isPending) return <LoadingState />;
  if (places.isError)
    return <ErrorState error={places.error} onRetry={() => void places.refetch()} />;
  if (places.data.length === 0) return null;
  return (
    <ul className="tree">
      {places.data.map((place) => (
        <RollItem key={place.id} place={place} />
      ))}
    </ul>
  );
}

function RollItem({ place }: { place: Place }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <div className="tree-row">
        {place.type === 'part' ? (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={expanded}
            aria-label={`${t(LEVEL[place.type])} ${place.code} ${place.name}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-toggle" aria-hidden="true" />
        )}
        <PlaceLabel place={place} />
        <span className="tree-note">{t('geography.fromRolls')}</span>
      </div>
      {expanded ? <RollPlaces parentId={place.id} /> : null}
    </li>
  );
}

/** Renames a State, PC or AC, or changes its reservation (audited by the API). */
export function EditPlace({ place, onDone }: { place: Place; onDone: () => void }) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const reservationId = useId();
  const [name, setName] = useState(place.name);
  const [reservation, setReservation] = useState(place.reservation ?? '');

  // Only what changed, so the audit log records the right fields.
  const changes: { name?: string; reservation?: string | null } = {};
  if (name.trim() !== place.name) changes.name = name.trim();
  if ((reservation.trim() || null) !== place.reservation) {
    changes.reservation = reservation.trim() || null;
  }
  const unchanged = Object.keys(changes).length === 0;

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().PATCH('/v1/geographies/{id}', {
          params: {
            path: { id: place.id },
            header: { 'Idempotency-Key': newIdempotencyKey() },
          },
          body: changes,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['geography'] });
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) onDone();
    else save.mutate();
  };

  return (
    <form className="form form-inline tree-edit" onSubmit={submit}>
      <label htmlFor={nameId}>{t('geography.name')}</label>
      <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} required />
      <label htmlFor={reservationId}>{t('geography.reservation')}</label>
      <input
        id={reservationId}
        value={reservation}
        maxLength={50}
        aria-describedby={`${reservationId}-hint`}
        onChange={(event) => setReservation(event.target.value)}
      />
      <span id={`${reservationId}-hint`} className="form-hint">
        {t('geography.reservationHint')}
      </span>
      <button
        type="submit"
        className="button button-small"
        disabled={save.isPending || !name.trim()}
      >
        {t('geography.save')}
      </button>
      <button type="button" className="button button-quiet button-small" onClick={onDone}>
        {t('geography.cancel')}
      </button>
      {save.isError ? (
        <p role="alert" className="form-error">
          {save.error instanceof ApiRequestError && save.error.status === 404
            ? t('geography.outsideArea')
            : errorMessage(save.error)}
        </p>
      ) : null}
    </form>
  );
}
