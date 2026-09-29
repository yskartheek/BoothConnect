import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Scope } from '../authz/scope.service';
import { notFound } from '../authz/scoped-query';
import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import type { GeographyNodeType } from '../generated/prisma/client';
import type { RawMetrics } from './metrics';
import {
  COUNT_KEYS,
  definitionOf,
  type Figure,
  type Figures,
  FIGURE_KEYS,
  SUPPRESSED,
  suppressFamily,
  suppressNode,
} from './suppression';

export interface NodeRef {
  id: string;
  type: GeographyNodeType;
  code: string;
  name: string;
}

interface Common {
  node: NodeRef;
  /** Groups smaller than this are suppressed. */
  minCohort: number;
  /** What each figure means (design §7: every card shows its definition). */
  definitions: Record<string, string>;
}

export interface NodeSummary extends Common {
  /** When the figures were last computed; null if they haven't been yet. */
  computedAt: Date | null;
  metrics: Figures;
}

export interface ChildrenBreakdown extends Common {
  computedAt: Date | null;
  /** The parent's figures, as shown next to the children. */
  total: Figures;
  /** Per child: counts are the parent's total ÷ the number of children; ratios the parent's. */
  average: Figures;
  children: { node: NodeRef; computedAt: Date | null; metrics: Figures }[];
}

export interface Revisions extends Common {
  /** Against the previous revision, summed over the parts below (design §7). */
  current: { additions: Figure; deletions: Figure; net: Figure };
  /** A part's revisions, oldest first (empty above part level). */
  versions: {
    id: string;
    revisionYear: number;
    revisionType: string;
    createdAt: Date;
    voters: Figure;
    additions: Figure;
    deletions: Figure;
  }[];
}

type Stats = { metrics: RawMetrics; computedAt: Date } | null;

const NODE_SELECT = { id: true, type: true, code: true, name: true, parentId: true } as const;
const definitions = Object.fromEntries(FIGURE_KEYS.map((k) => [k, definitionOf(k)]));
const empty: Figures = Object.fromEntries(FIGURE_KEYS.map((k) => [k, null]));
const ref = ({ id, type, code, name }: NodeRef): NodeRef => ({ id, type, code, name });

/**
 * The analytics API (#49; design §7): any node's figures from `node_stats`,
 * its children side by side, and revision changes, all with small groups
 * suppressed (see `suppression.ts`). Nodes outside the caller's area are
 * 404. Aggregates only: no record-level data.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get cohort(): number {
    return this.config.get('ANALYTICS_MIN_COHORT', { infer: true });
  }

  async summary(scope: Scope, nodeId: string): Promise<NodeSummary> {
    const node = await this.nodeInScope(scope, nodeId);
    const stats = await this.stats([node.id]);
    const own = stats.get(node.id) ?? null;
    let metrics: Figures;
    if (!own) metrics = empty;
    else if (node.parentId) {
      // As its row among its siblings, so the summary and the parent's
      // children table can't be combined to undo a suppression.
      const family = await this.family(node.parentId);
      metrics = family.children.find((c) => c.node.id === node.id)?.metrics ?? empty;
    } else metrics = suppressNode(own.metrics, this.cohort);
    return {
      node: ref(node),
      computedAt: own?.computedAt ?? null,
      minCohort: this.cohort,
      metrics,
      definitions,
    };
  }

  async children(
    scope: Scope,
    nodeId: string,
    metric?: string,
    order: 'asc' | 'desc' = 'desc',
  ): Promise<ChildrenBreakdown> {
    const node = await this.nodeInScope(scope, nodeId);
    const family = await this.family(node.id);
    const n = family.children.length;
    const average: Figures = {};
    for (const key of FIGURE_KEYS) {
      const value = family.total[key] ?? null;
      average[key] =
        COUNT_KEYS.includes(key) && typeof value === 'number'
          ? n > 0
            ? Math.round((value / n) * 10) / 10
            : null
          : value;
    }
    const children = [...family.children].sort((a, b) =>
      metric ? compare(a.metrics[metric] ?? null, b.metrics[metric] ?? null, order) : byCode(a, b),
    );
    return {
      node: ref(node),
      computedAt: family.computedAt,
      minCohort: this.cohort,
      total: family.total,
      average,
      children,
      definitions,
    };
  }

  async revisions(scope: Scope, nodeId: string): Promise<Revisions> {
    const node = await this.nodeInScope(scope, nodeId);
    const { metrics } = await this.summary(scope, node.id);
    const versions =
      node.type === 'part'
        ? await this.prisma.$queryRaw<
            {
              id: string;
              revision_year: number;
              revision_type: string;
              created_at: Date;
              voters: number;
              additions: number | null;
              deletions: number | null;
            }[]
          >`
            SELECT sv.id, sv.revision_year, sv.revision_type, sv.created_at,
              (SELECT count(*) FROM voter v WHERE v.source_version_id = sv.id)::int AS voters,
              CASE WHEN sv.previous_version_id IS NULL THEN NULL ELSE
                (SELECT count(*) FROM voter v WHERE v.source_version_id = sv.id
                   AND NOT EXISTS (SELECT 1 FROM voter p WHERE p.source_version_id = sv.previous_version_id
                                   AND p.source_voter_id = v.source_voter_id))::int END AS additions,
              CASE WHEN sv.previous_version_id IS NULL THEN NULL ELSE
                (SELECT count(*) FROM voter p WHERE p.source_version_id = sv.previous_version_id
                   AND NOT EXISTS (SELECT 1 FROM voter v WHERE v.source_version_id = sv.id
                                   AND v.source_voter_id = p.source_voter_id))::int END AS deletions
            FROM source_version sv WHERE sv.part_node_id = ${node.id}::uuid
            ORDER BY sv.created_at, sv.id`
        : [];
    const small = (v: number | null) => v !== null && v > 0 && v < this.cohort;
    return {
      node: ref(node),
      minCohort: this.cohort,
      current: {
        additions: metrics['revisions.additions'] ?? null,
        deletions: metrics['revisions.deletions'] ?? null,
        net: metrics['revisions.net'] ?? null,
      },
      versions: versions.map((v) => {
        // One of the pair shown would give the other away through the voter counts.
        const hide = small(v.additions) || small(v.deletions);
        return {
          id: v.id,
          revisionYear: v.revision_year,
          revisionType: v.revision_type,
          createdAt: v.created_at,
          voters: small(v.voters) ? SUPPRESSED : v.voters,
          additions: hide ? SUPPRESSED : v.additions,
          deletions: hide ? SUPPRESSED : v.deletions,
        };
      }),
      definitions: {
        'revisions.additions': definitionOf('revisions.additions'),
        'revisions.deletions': definitionOf('revisions.deletions'),
        'revisions.net': definitionOf('revisions.net'),
      },
    };
  }

  /** A parent and its children with suppression applied across them. */
  private async family(parentId: string) {
    const kids = await this.prisma.geographyNode.findMany({
      where: { parentId },
      select: NODE_SELECT,
    });
    const stats = await this.stats([parentId, ...kids.map((k) => k.id)]);
    const parent = stats.get(parentId) ?? null;
    const counted = kids.filter((k) => stats.get(k.id));
    const suppressed = parent
      ? suppressFamily(
          parent.metrics,
          counted.map((k) => stats.get(k.id)!.metrics),
          this.cohort,
        )
      : null;
    return {
      computedAt: parent?.computedAt ?? null,
      total: suppressed?.parent ?? empty,
      children: kids.map((k) => {
        const i = counted.indexOf(k);
        return {
          node: ref(k),
          computedAt: stats.get(k.id)?.computedAt ?? null,
          metrics: suppressed && i >= 0 ? suppressed.children[i]! : empty,
        };
      }),
    };
  }

  private async stats(ids: string[]): Promise<Map<string, NonNullable<Stats>>> {
    const rows = await this.prisma.nodeStats.findMany({
      where: { nodeId: { in: ids } },
      select: { nodeId: true, metrics: true, computedAt: true },
    });
    return new Map(
      rows.map((r) => [
        r.nodeId,
        { metrics: r.metrics as unknown as RawMetrics, computedAt: r.computedAt },
      ]),
    );
  }

  private async nodeInScope(scope: Scope, nodeId: string) {
    const node = await this.prisma.geographyNode.findFirst({
      where: { id: nodeId, ancestors: { some: { ancestorId: { in: scope.nodeIds } } } },
      select: NODE_SELECT,
    });
    if (!node) throw notFound('Geography node');
    return node;
  }
}

/** Numbers first (in the order asked), then suppressed, then not collected. */
function compare(a: Figure, b: Figure, order: 'asc' | 'desc'): number {
  const rank = (f: Figure) => (typeof f === 'number' ? 0 : f === SUPPRESSED ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a !== 'number' || typeof b !== 'number') return 0;
  return order === 'asc' ? a - b : b - a;
}

function byCode(a: { node: NodeRef }, b: { node: NodeRef }): number {
  return a.node.code.localeCompare(b.node.code, undefined, { numeric: true });
}
