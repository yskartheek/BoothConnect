'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { apiClient, unwrap } from '@/lib/api';
import { allChildren, LEVEL, type Place } from '@/lib/geography';
import { t } from '@/lib/i18n';

import { errorMessage } from './states';

/** A node of the admin's area: what the picker shows and returns. */
export type AreaNode = Pick<Place, 'id' | 'type' | 'code' | 'name'>;

/** An admin node, with the nodes above it (State first). */
export interface AdminArea extends AreaNode {
  ancestors: AreaNode[];
}

export const placeLabel = (node: AreaNode) => `${t(LEVEL[node.type])} ${node.code} ${node.name}`;

/** Levels offered in a dropdown with a search box, when it has more options than this. */
const SEARCH_FROM = 8;

const DEPTH: Record<Place['type'], number> = {
  state: 0,
  pc: 1,
  ac: 2,
  part: 3,
  polling_station: 4,
};

/** The nodes the signed-in admin manages: their active admin assignments. */
export function useAdminAreas() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => unwrap(apiClient().GET('/v1/me')),
    select: (me) => ({
      userId: me.id,
      areas: me.assignments
        .filter((a) => a.role === 'admin')
        .map((a): AdminArea => ({
          id: a.node.id,
          type: a.node.type,
          code: a.node.code,
          name: a.node.name,
          ancestors: a.path.filter((n) => n.id !== a.node.id),
        })),
    }),
  });
}

/**
 * Cascading dropdowns over the admin's area (#176, #71): the first lists
 * their admin nodes, and each choice adds a dropdown for the level below,
 * down to `deepest` (polling stations by default). Nothing above or beside
 * their area is offered. Long lists (an AC has 250–300 parts) get a search
 * box. The value is the chosen path; its last node is the choice (none: the
 * whole area, or nothing chosen yet). Changing a level drops the levels below.
 */
export function AreaPicker({
  legend,
  path,
  onChange,
  emptyLabel,
  deepest = 'polling_station',
}: {
  legend: string;
  path: AreaNode[];
  onChange: (path: AreaNode[]) => void;
  /** The first option of each dropdown, e.g. "All of my area" or "Choose…". */
  emptyLabel: string;
  /** The lowest level offered. */
  deepest?: Place['type'];
}) {
  const areas = useAdminAreas();
  const roots = areas.data?.areas ?? [];
  const last = path.at(-1);
  // One dropdown per chosen node, plus one for the level below the last.
  const parents = [null, ...path].slice(
    0,
    last && DEPTH[last.type] >= DEPTH[deepest] ? path.length : undefined,
  );

  return (
    <fieldset className="area-picker">
      <legend>{legend}</legend>
      {parents.map((parent, depth) => (
        <Level
          key={parent?.id ?? 'root'}
          parent={parent}
          roots={roots}
          value={path[depth]?.id ?? ''}
          emptyLabel={emptyLabel}
          onPick={(node) => onChange(node ? [...path.slice(0, depth), node] : path.slice(0, depth))}
        />
      ))}
    </fieldset>
  );
}

/** Code prefix or part of the name, ignoring case. */
const matches = (node: AreaNode, search: string) => {
  const q = search.trim().toLowerCase();
  return !q || node.code.toLowerCase().startsWith(q) || node.name.toLowerCase().includes(q);
};

function Level({
  parent,
  roots,
  value,
  emptyLabel,
  onPick,
}: {
  parent: AreaNode | null;
  roots: AreaNode[];
  value: string;
  emptyLabel: string;
  onPick: (node: AreaNode | null) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const children = useQuery({
    queryKey: ['geography', 'children', parent?.id],
    queryFn: () => allChildren(parent!.id),
    enabled: parent !== null,
  });
  const options: (AreaNode | Place)[] = parent ? (children.data ?? []) : roots;
  // Nothing below (a part not yet imported): no dropdown.
  if (parent && children.isSuccess && options.length === 0) return null;
  if (children.isError) {
    return (
      <p role="alert" className="form-error">
        {errorMessage(children.error)}
      </p>
    );
  }
  const label = parent
    ? options[0]
      ? t(LEVEL[options[0].type])
      : t('area.level')
    : t('area.yourArea');
  // The chosen option stays listed, so the dropdown keeps showing it.
  const shown = options.filter((node) => node.id === value || matches(node, search));

  return (
    <div className="area-picker-level">
      {options.length > SEARCH_FROM ? (
        <>
          <label htmlFor={`${id}-search`} className="visually-hidden">
            {t('area.search', { level: label })}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={search}
            placeholder={t('area.search', { level: label })}
            onChange={(event) => setSearch(event.target.value)}
          />
        </>
      ) : null}
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={parent !== null && !children.isSuccess}
        onChange={(event) => onPick(options.find((o) => o.id === event.target.value) ?? null)}
      >
        <option value="">{emptyLabel}</option>
        {shown.map((node) => (
          <option key={node.id} value={node.id}>
            {parent ? `${node.code} ${node.name}` : placeLabel(node)}
            {'isAuxiliary' in node && node.isAuxiliary ? ` · ${t('geography.auxiliary')}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The chosen place as a breadcrumb, from the State down. */
export function PlaceBreadcrumb({ path, label }: { path: AreaNode[]; label: string }) {
  const areas = useAdminAreas();
  const root = path[0] && areas.data?.areas.find((a) => a.id === path[0]!.id);
  const nodes = [...(root ? root.ancestors : []), ...path];
  if (nodes.length === 0) return null;
  return (
    <nav aria-label={label} className="breadcrumb">
      <ol>
        {nodes.map((node, i) => (
          <li key={node.id} aria-current={i === nodes.length - 1 ? 'location' : undefined}>
            {placeLabel(node)}
          </li>
        ))}
      </ol>
    </nav>
  );
}
