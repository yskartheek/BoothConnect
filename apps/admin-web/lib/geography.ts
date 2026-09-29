import type { Schemas } from '@boothconnect/api-client';

import { apiClient, unwrap } from './api';
import type { MessageKey } from './i18n';

export type Place = Schemas['GeographyNodeView'];

/** The name of each level, e.g. "AC" or "Polling station". */
export const LEVEL: Record<Place['type'], MessageKey> = {
  state: 'geography.levelState',
  pc: 'geography.levelPc',
  ac: 'geography.levelAc',
  part: 'geography.levelPart',
  polling_station: 'geography.levelStation',
};

/** Every child of a node (or the top level) the admin can see, across pages. */
export async function allChildren(parentId: string | null): Promise<Place[]> {
  const items: Place[] = [];
  let cursor: string | undefined;
  do {
    const page = await unwrap(
      apiClient().GET('/v1/geographies', {
        params: { query: { ...(parentId ? { parentId } : {}), limit: 200, cursor } },
      }),
    );
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
