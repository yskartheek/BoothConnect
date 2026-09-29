'use client';

import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { apiClient, unwrap } from '@/lib/api';
import { allChildren, LEVEL, type Place } from '@/lib/geography';
import { t } from '@/lib/i18n';

import { errorMessage } from '../states';

/** A node of the admin's area: what the picker shows and returns. */
export type AreaNode = Pick<Place, 'id' | 'type' | 'code' | 'name'>;

export const placeLabel = (node: AreaNode) => `${t(LEVEL[node.type])} ${node.code} ${node.name}`;

/** The nodes the signed-in admin manages: their active admin assignments. */
export function useAdminAreas() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => unwrap(apiClient().GET('/v1/me')),
    select: (me) => ({
      userId: me.id,
      areas: me.assignments
        .filter((a) => a.role === 'admin')
        .map((a): AreaNode => ({
          id: a.node.id,
          type: a.node.type,
          code: a.node.code,
          name: a.node.name,
        })),
    }),
  });
}

/**
 * Cascading dropdowns over the admin's area (#176): the first lists their
 * admin nodes, and each choice adds a dropdown for the level below, down to
 * polling stations. Nothing above or beside their area is offered. The value
 * is the chosen path; its last node is the choice (none: the whole area, or
 * nothing chosen yet).
 */
export function AreaPicker({
  legend,
  path,
  onChange,
  emptyLabel,
}: {
  legend: string;
  path: AreaNode[];
  onChange: (path: AreaNode[]) => void;
  /** The first option of each dropdown, e.g. "All of my area" or "Choose…". */
  emptyLabel: string;
}) {
  const areas = useAdminAreas();
  const roots = areas.data?.areas ?? [];
  const last = path.at(-1);
  // One dropdown per chosen node, plus one for the level below the last.
  const parents = [null, ...path].slice(
    0,
    last?.type === 'polling_station' ? path.length : undefined,
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
  const children = useQuery({
    queryKey: ['geography', 'children', parent?.id],
    queryFn: () => allChildren(parent!.id),
    enabled: parent !== null,
  });
  const options = parent ? (children.data ?? []) : roots;
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
      : t('users.level')
    : t('users.area');

  return (
    <div className="area-picker-level">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={parent !== null && !children.isSuccess}
        onChange={(event) => onPick(options.find((o) => o.id === event.target.value) ?? null)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((node) => (
          <option key={node.id} value={node.id}>
            {parent ? `${node.code} ${node.name}` : placeLabel(node)}
            {'isAuxiliary' in node && node.isAuxiliary ? ` · ${t('geography.auxiliary')}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
