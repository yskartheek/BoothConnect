import { parseCsv } from '../common/csv';

/**
 * Planning a State → PC → AC master-data upload (#100; design §2): which
 * rows create, update or leave a node alone, and which are wrong. Pure, so
 * the preview and the confirm use exactly the same plan.
 *
 * CSV columns: `level` (state, pc, ac), `code`, `name`, `reservation`
 * (optional), `parent_code` (the state's code for a PC, the PC's code for an
 * AC) and `state_code` (optional; tells an AC's PC apart when two states
 * have a PC with the same code).
 */

export const MASTER_LEVELS = ['state', 'pc', 'ac'] as const;
export type MasterLevel = (typeof MASTER_LEVELS)[number];

const REQUIRED = ['level', 'code', 'name', 'parent_code'] as const;
const OPTIONAL = ['reservation', 'state_code'] as const;
export const MAX_ROWS = 5000;

export interface MasterRow {
  /** Line in the file (the header is line 1). */
  line: number;
  level: string;
  code: string;
  name: string;
  reservation: string | null;
  parentCode: string | null;
  stateCode: string | null;
}

/** A State, PC or AC already in the master data. */
export interface ExistingNode {
  id: string;
  level: MasterLevel;
  code: string;
  name: string;
  reservation: string | null;
  /** The node's path of codes: `S29`, `S29/6`, `S29/6/40`. */
  key: string;
}

export type RowAction = 'create' | 'update' | 'unchanged' | 'error';

export interface PlannedRow {
  line: number;
  level: string;
  code: string;
  name: string;
  reservation: string | null;
  parentCode: string | null;
  action: RowAction;
  errors: string[];
  /** The node's path of codes, once its parent is known. */
  key: string | null;
  parentKey: string | null;
  /** The existing node (update or unchanged). */
  nodeId: string | null;
}

/** Reads the CSV; a problem with the file itself (not a row) is thrown as a message. */
export function readMasterCsv(text: string): MasterRow[] {
  // An unclosed quote throws; the service reports it as the file's problem.
  const table = parseCsv(text);
  const [header, ...body] = table;
  if (!header) throw new Error('The file is empty');
  const columns = header.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !columns.includes(c));
  if (missing.length > 0) throw new Error(`Missing column(s): ${missing.join(', ')}`);
  const unknown = columns.filter(
    (c) =>
      !(REQUIRED as readonly string[]).includes(c) && !(OPTIONAL as readonly string[]).includes(c),
  );
  if (unknown.length > 0) throw new Error(`Unknown column(s): ${unknown.join(', ')}`);
  if (body.length === 0) throw new Error('The file has no rows');
  if (body.length > MAX_ROWS) throw new Error(`At most ${MAX_ROWS} rows per file`);
  const at = (cells: string[], column: string) => {
    const i = columns.indexOf(column);
    const value = i >= 0 ? (cells[i] ?? '').trim() : '';
    return value === '' ? null : value;
  };
  return body.map((cells, i) => ({
    line: i + 2,
    level: (at(cells, 'level') ?? '').toLowerCase(),
    code: at(cells, 'code') ?? '',
    name: at(cells, 'name') ?? '',
    reservation: at(cells, 'reservation'),
    parentCode: at(cells, 'parent_code'),
    stateCode: at(cells, 'state_code'),
  }));
}

export interface PlanOptions {
  existing: ExistingNode[];
  /** May the caller change this existing node? */
  canEdit: (nodeId: string) => boolean;
  /** May the caller add a child under this existing node? */
  canAddUnder: (parentNodeId: string) => boolean;
  /** May the caller add a new State? */
  canAddState: boolean;
}

/** The plan for every row, in file order. Nothing is written. */
export function planMasterData(rows: MasterRow[], options: PlanOptions): PlannedRow[] {
  const existing = new Map(options.existing.map((n) => [n.key, n]));
  const planned = rows.map((row): PlannedRow => ({
    line: row.line,
    level: row.level,
    code: row.code,
    name: row.name,
    reservation: row.reservation,
    parentCode: row.parentCode,
    action: 'error',
    errors: [],
    key: null,
    parentKey: null,
    nodeId: null,
  }));
  /** Nodes this file creates, by key: whether their row is valid. */
  const created = new Map<string, PlannedRow>();
  const seen = new Map<string, number>();

  // Parents before children, whatever the order in the file.
  for (const level of MASTER_LEVELS) {
    rows.forEach((row, i) => {
      if (row.level !== level) return;
      const out = planned[i]!;
      const errors = out.errors;
      if (!row.code) errors.push('code is required');
      else if (row.code.length > 50 || /[/]/.test(row.code)) {
        errors.push('code must be at most 50 characters, without "/"');
      }
      if (!row.name) errors.push('name is required');
      else if (row.name.length > 200) errors.push('name must be at most 200 characters');
      if (row.reservation && row.reservation.length > 50) {
        errors.push('reservation must be at most 50 characters');
      }

      // The parent: none for a State; a State for a PC; a PC for an AC.
      let parentKey: string | null = null;
      if (level === 'state') {
        if (row.parentCode) errors.push('a State has no parent_code');
      } else if (!row.parentCode) {
        errors.push(
          `parent_code is required for ${level === 'ac' ? 'an' : 'a'} ${level.toUpperCase()}`,
        );
      } else {
        const parentLevel = level === 'pc' ? 'state' : 'pc';
        const candidates = [
          ...options.existing.filter((n) => n.level === parentLevel).map((n) => n.key),
          ...[...created.keys()].filter(
            (k) => k.split('/').length === (parentLevel === 'state' ? 1 : 2),
          ),
        ].filter(
          (key, j, all) =>
            all.indexOf(key) === j &&
            key.split('/').at(-1) === row.parentCode &&
            (!row.stateCode || key.split('/')[0] === row.stateCode),
        );
        const what = parentLevel === 'state' ? 'State' : 'PC';
        if (candidates.length === 0) errors.push(`Unknown ${what} ${row.parentCode}`);
        else if (candidates.length > 1) {
          errors.push(
            `More than one ${what} has code ${row.parentCode}; add state_code to say which`,
          );
        } else {
          parentKey = candidates[0]!;
          const parentRow = created.get(parentKey);
          if (parentRow && parentRow.errors.length > 0) {
            errors.push(`Its ${what} (line ${parentRow.line}) has errors`);
          }
        }
      }
      if (errors.length > 0) {
        out.action = 'error';
        // A new node with a bad row: its children point at it, not "Unknown".
        const fine = row.code && !/[/]/.test(row.code) && (level === 'state' || parentKey);
        const key = parentKey ? `${parentKey}/${row.code}` : row.code;
        if (fine && !existing.has(key) && !created.has(key)) created.set(key, out);
        return;
      }

      const key = parentKey ? `${parentKey}/${row.code}` : row.code;
      out.key = key;
      out.parentKey = parentKey;
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        errors.push(`Same ${level.toUpperCase()} as line ${earlier}`);
        return;
      }
      seen.set(key, row.line);

      const node = existing.get(key);
      if (node) {
        out.nodeId = node.id;
        if (!options.canEdit(node.id)) errors.push('Outside your area');
        else {
          out.action =
            node.name === row.name && (node.reservation ?? null) === (row.reservation ?? null)
              ? 'unchanged'
              : 'update';
        }
        return;
      }
      const parentNode = parentKey ? existing.get(parentKey) : undefined;
      const allowed = parentKey
        ? parentNode
          ? options.canAddUnder(parentNode.id)
          : true // a parent this file creates, already checked
        : options.canAddState;
      if (!allowed) errors.push('Outside your area');
      else out.action = 'create';
      created.set(key, out);
    });
  }
  for (const row of planned) {
    if (row.errors.length > 0) row.action = 'error';
    if (!(MASTER_LEVELS as readonly string[]).includes(row.level)) {
      row.action = 'error';
      row.errors.push('level must be state, pc or ac');
    }
  }
  return planned;
}
