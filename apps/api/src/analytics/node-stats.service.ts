import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { NodeStatsRefresh } from './stats-refresh';
import {
  addMetrics,
  emptyMetrics,
  MAX_AGE,
  LARGE_HOUSEHOLD,
  type RawMetrics,
  sumMetrics,
} from './metrics';

type Tx = Prisma.TransactionClient;
type Own = Map<string, RawMetrics>;

/** Requests handled per refresh transaction. */
const REQUEST_BATCH = 1000;
/** Stations per query when computing own counts. */
const NODE_CHUNK = 1000;

const uuids = (ids: string[]) => Prisma.sql`${ids}::uuid[]`;

/**
 * Keeps `node_stats` up to date (#102; design §7). A refresh recomputes:
 *
 * - the **own** counts of every polling station and part under the
 *   requested nodes: voters, households, revision changes, data quality
 *   and field work at a station; import quality at a part;
 * - the **totals** of those nodes and every ancestor, bottom-up: own plus
 *   the children's totals. Nothing outside that path is touched.
 *
 * Requests are queued in `node_stats_request`, in the same transaction as
 * the change that caused them (import confirm, a visit), and drained here
 * with FOR UPDATE SKIP LOCKED, right away or by a sweep every
 * ANALYTICS_REFRESH_SECONDS. Refreshes run one at a time (an advisory
 * lock), so two never compute the same ancestor from half-updated children.
 * `rebuildAll()` recomputes everything; on start-up it runs if the table is
 * empty.
 */
@Injectable()
export class NodeStatsService
  extends NodeStatsRefresh
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NodeStatsService.name);
  private timer?: NodeJS.Timeout;
  private draining: Promise<void> | null = null;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  onModuleInit(): void {
    const every = this.config.get('ANALYTICS_REFRESH_SECONDS', { infer: true }) * 1000;
    this.timer = setInterval(() => this.kick(), every);
    this.timer.unref();
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      // First start (or a fresh database): build everything once.
      if ((await this.prisma.nodeStats.count()) === 0) await this.requestRoots();
    } catch (error) {
      this.logger.warn(`node stats bootstrap skipped: ${(error as Error).message}`);
    }
    this.kick();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    await this.draining;
  }

  /** Queues nodes for a refresh; pass `tx` to queue as part of the caller's change. */
  async request(nodeIds: string[], tx?: Tx): Promise<void> {
    if (nodeIds.length === 0) return;
    await (tx ?? this.prisma).nodeStatsRequest.createMany({
      data: [...new Set(nodeIds)].map((nodeId) => ({ nodeId })),
      skipDuplicates: true,
    });
    if (!tx) this.kick();
  }

  /** Recomputes every node of every program. */
  async rebuildAll(): Promise<void> {
    await this.requestRoots();
    await this.drain();
  }

  kick(): void {
    if (this.closing || this.draining) return;
    this.draining = this.run()
      .catch((error: unknown) => this.logger.error('node stats refresh failed', error as Error))
      .finally(() => {
        this.draining = null;
      });
  }

  /** Waits until every queued request has been handled. */
  async drain(): Promise<void> {
    await this.draining;
    await this.run();
  }

  private async run(): Promise<void> {
    while (!this.closing && (await this.refreshNext())) {
      // next batch
    }
  }

  private async requestRoots(): Promise<void> {
    const roots = await this.prisma.geographyNode.findMany({
      where: { parentId: null },
      select: { id: true },
    });
    await this.request(roots.map((r) => r.id));
  }

  /** Handles the next batch of requests; false when the queue is empty. */
  private async refreshNext(): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('node_stats'))`;
        const requests = await tx.$queryRaw<{ node_id: string }[]>`
          SELECT node_id FROM node_stats_request ORDER BY requested_at, node_id
          LIMIT ${REQUEST_BATCH} FOR UPDATE SKIP LOCKED`;
        if (requests.length === 0) return false;
        const ids = requests.map((r) => r.node_id);
        await tx.nodeStatsRequest.deleteMany({ where: { nodeId: { in: ids } } });
        await this.refresh(tx, ids);
        return true;
      },
      { timeout: 600_000, maxWait: 60_000 },
    );
  }

  /** Recomputes the own counts under `nodeIds` and the totals up to the root. */
  private async refresh(tx: Tx, nodeIds: string[]): Promise<void> {
    const leaves = await tx.$queryRaw<{ id: string; type: string }[]>`
      SELECT DISTINCT n.id, n.type::text AS type
      FROM geography_closure c JOIN geography_node n ON n.id = c.descendant_id
      WHERE c.ancestor_id = ANY(${uuids(nodeIds)}) AND n.type IN ('part', 'polling_station')`;
    const stations = leaves.filter((l) => l.type === 'polling_station').map((l) => l.id);
    const parts = leaves.filter((l) => l.type === 'part').map((l) => l.id);
    const own: Own = new Map();
    for (let i = 0; i < stations.length; i += NODE_CHUNK) {
      await this.stationCounts(tx, stations.slice(i, i + NODE_CHUNK), own);
    }
    for (let i = 0; i < parts.length; i += NODE_CHUNK) {
      await this.partCounts(tx, parts.slice(i, i + NODE_CHUNK), own);
    }

    // Every node on a path from a refreshed node to its root, deepest first.
    const touched = [...new Set([...nodeIds, ...stations, ...parts])];
    const path = await tx.$queryRaw<
      { id: string; program_id: string; level: number; own: RawMetrics | null }[]
    >`
      SELECT n.id, n.program_id, lv.level, s.own
      FROM (SELECT DISTINCT ancestor_id FROM geography_closure
            WHERE descendant_id = ANY(${uuids(touched)})) a
      JOIN geography_node n ON n.id = a.ancestor_id
      JOIN LATERAL (SELECT max(depth)::int AS level FROM geography_closure
                    WHERE descendant_id = n.id) lv ON TRUE
      LEFT JOIN node_stats s ON s.node_id = n.id
      ORDER BY lv.level DESC`;
    const levels = new Map<number, typeof path>();
    for (const node of path) levels.set(node.level, [...(levels.get(node.level) ?? []), node]);
    const computedAt = new Date();
    for (const level of [...levels.keys()].sort((a, b) => b - a)) {
      const nodes = levels.get(level)!;
      const children = await tx.$queryRaw<{ parent_id: string; metrics: RawMetrics }[]>`
        SELECT n.parent_id, s.metrics FROM geography_node n JOIN node_stats s ON s.node_id = n.id
        WHERE n.parent_id = ANY(${uuids(nodes.map((n) => n.id))})`;
      const byParent = new Map<string, RawMetrics[]>();
      for (const c of children)
        byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c.metrics]);
      const rows = nodes.map((node) => {
        const mine = own.get(node.id) ?? node.own ?? emptyMetrics();
        return {
          nodeId: node.id,
          programId: node.program_id,
          own: mine,
          metrics: addMetrics(sumMetrics(byParent.get(node.id) ?? []), mine),
        };
      });
      for (let i = 0; i < rows.length; i += NODE_CHUNK) {
        await upsert(tx, rows.slice(i, i + NODE_CHUNK), computedAt);
      }
    }
  }

  /** A station's own counts: voters, households, revisions, data quality, field work. */
  private async stationCounts(tx: Tx, ids: string[], own: Own): Promise<void> {
    for (const id of ids) own.set(id, emptyMetrics());
    const at = (id: string) => own.get(id)!;
    const list = uuids(ids);

    const electors = await tx.$queryRaw<
      {
        id: string;
        total: number;
        male: number;
        female: number;
        third: number;
        unknown: number;
        missing_age: number;
        missing_gender: number;
        duplicate_epics: number;
      }[]
    >`
      SELECT v.polling_station_id AS id, count(*)::int AS total,
        count(*) FILTER (WHERE v.source_data->>'gender' = 'male')::int AS male,
        count(*) FILTER (WHERE v.source_data->>'gender' = 'female')::int AS female,
        count(*) FILTER (WHERE v.source_data->>'gender' = 'third_gender')::int AS third,
        count(*) FILTER (WHERE COALESCE(v.source_data->>'gender', '')
          NOT IN ('male', 'female', 'third_gender'))::int AS unknown,
        count(*) FILTER (WHERE v.origin = 'official_import'
          AND jsonb_typeof(v.source_data->'age') IS DISTINCT FROM 'number')::int AS missing_age,
        count(*) FILTER (WHERE v.origin = 'official_import' AND COALESCE(v.source_data->>'gender', '')
          NOT IN ('male', 'female', 'third_gender'))::int AS missing_gender,
        count(*) FILTER (WHERE v.source_voter_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM voter o WHERE o.program_id = v.program_id AND o.id <> v.id
            AND o.record_status = 'active' AND o.source_voter_id = v.source_voter_id))::int
          AS duplicate_epics
      FROM voter v
      WHERE v.record_status = 'active' AND v.polling_station_id = ANY(${list})
      GROUP BY 1`;
    for (const e of electors) {
      const m = at(e.id);
      m.electors = {
        total: e.total,
        male: e.male,
        female: e.female,
        thirdGender: e.third,
        unknown: e.unknown,
      };
      m.quality.missingAge = e.missing_age;
      m.quality.missingGender = e.missing_gender;
      m.quality.duplicateEpics = e.duplicate_epics;
      m.ages.unknown = e.total;
    }

    const ages = await tx.$queryRaw<{ id: string; age: number; n: number }[]>`
      SELECT v.polling_station_id AS id,
        LEAST((v.source_data->>'age')::numeric::int, ${MAX_AGE})::int AS age, count(*)::int AS n
      FROM voter v
      WHERE v.record_status = 'active' AND v.polling_station_id = ANY(${list})
        AND jsonb_typeof(v.source_data->'age') = 'number'
      GROUP BY 1, 2`;
    for (const a of ages) {
      const m = at(a.id);
      m.ages.byAge[String(a.age)] = a.n;
      m.ages.unknown -= a.n;
    }

    const households = await tx.$queryRaw<{ id: string; total: number; large: number }[]>`
      SELECT h.polling_station_id AS id, count(*)::int AS total,
        count(*) FILTER (WHERE (SELECT count(*) FROM voter v
          WHERE v.household_id = h.id AND v.record_status = 'active') > ${LARGE_HOUSEHOLD})::int AS large
      FROM household h
      WHERE h.status = 'active' AND h.polling_station_id = ANY(${list})
      GROUP BY 1`;
    for (const h of households) at(h.id).households = { total: h.total, large: h.large };

    // Against the part's previous revision: voters whose EPIC is new, and
    // previous voters (at the station they were at) whose EPIC is gone.
    const additions = await tx.$queryRaw<{ id: string; n: number }[]>`
      SELECT v.polling_station_id AS id, count(*)::int AS n
      FROM voter v JOIN source_version cur ON cur.id = v.source_version_id
      WHERE v.record_status = 'active' AND v.polling_station_id = ANY(${list})
        AND cur.previous_version_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM voter p WHERE p.source_version_id = cur.previous_version_id
                        AND p.source_voter_id = v.source_voter_id)
      GROUP BY 1`;
    for (const a of additions) at(a.id).revisions.additions = a.n;
    const deletions = await tx.$queryRaw<{ id: string; n: number }[]>`
      SELECT p.polling_station_id AS id, count(*)::int AS n
      FROM voter p JOIN source_version cur ON cur.previous_version_id = p.source_version_id
      WHERE p.polling_station_id = ANY(${list})
        AND NOT EXISTS (SELECT 1 FROM source_version nx WHERE nx.previous_version_id = cur.id)
        AND NOT EXISTS (SELECT 1 FROM voter c WHERE c.source_version_id = cur.id
                        AND c.source_voter_id = p.source_voter_id)
      GROUP BY 1`;
    for (const d of deletions) at(d.id).revisions.deletions = d.n;
    const compared = await tx.$queryRaw<{ id: string }[]>`
      SELECT st.id FROM geography_node st JOIN source_version sv ON sv.part_node_id = st.parent_id
      WHERE st.id = ANY(${list}) AND sv.previous_version_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM source_version nx WHERE nx.previous_version_id = sv.id)`;
    for (const c of compared) at(c.id).revisions.stationsCompared = 1;

    // Field work. A visit that another visit corrects doesn't count; the
    // correction does.
    const work = await tx.$queryRaw<
      { id: string; assigned: number; visited: number; voters_met: number }[]
    >`
      SELECT h.polling_station_id AS id,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM geography_closure c JOIN role_assignment r ON r.geography_node_id = c.ancestor_id
          WHERE c.descendant_id = h.polling_station_id AND r.role = 'volunteer'
            AND r.valid_from <= now() AND (r.valid_until IS NULL OR r.valid_until > now())))::int
          AS assigned,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM visit vi WHERE vi.household_id = h.id))::int
          AS visited,
        COALESCE(sum((SELECT count(DISTINCT m.voter_id) FROM visit vi
          JOIN visit_member m ON m.visit_id = vi.id JOIN voter v ON v.id = m.voter_id
          WHERE vi.household_id = h.id AND v.record_status = 'active'
            AND NOT EXISTS (SELECT 1 FROM visit c WHERE c.corrects_visit_id = vi.id))), 0)::int
          AS voters_met
      FROM household h
      WHERE h.status = 'active' AND h.polling_station_id = ANY(${list})
      GROUP BY 1`;
    for (const w of work) {
      const f = at(w.id).fieldWork;
      f.householdsAssigned = w.assigned;
      f.householdsVisited = w.visited;
      f.votersMet = w.voters_met;
    }
    const outcomes = await tx.$queryRaw<{ id: string; outcome: string; n: number }[]>`
      SELECT h.polling_station_id AS id, latest.outcome::text AS outcome, count(*)::int AS n
      FROM household h
      JOIN LATERAL (
        SELECT vi.outcome FROM visit vi
        WHERE vi.household_id = h.id
          AND NOT EXISTS (SELECT 1 FROM visit c WHERE c.corrects_visit_id = vi.id)
        ORDER BY vi.started_at DESC, vi.id DESC LIMIT 1) latest ON TRUE
      WHERE h.status = 'active' AND h.polling_station_id = ANY(${list})
      GROUP BY 1, 2`;
    for (const o of outcomes) at(o.id).fieldWork.outcomes[o.outcome] = o.n;
  }

  /** A part's own counts: the import quality of its current revision. */
  private async partCounts(tx: Tx, ids: string[], own: Own): Promise<void> {
    for (const id of ids) own.set(id, emptyMetrics());
    const quality = await tx.$queryRaw<
      {
        id: string;
        files: number;
        quality_sum: number;
        rows: number;
        corrected: number;
        rejected: number;
      }[]
    >`
      SELECT sv.part_node_id AS id, count(*)::int AS files,
        COALESCE(sum(f.quality_score), 0)::float8 AS quality_sum,
        COALESCE(sum(rc.rows), 0)::int AS rows,
        COALESCE(sum(rc.corrected), 0)::int AS corrected,
        COALESCE(sum(rc.rejected), 0)::int AS rejected
      FROM source_version sv
      JOIN import_file f ON f.source_version_id = sv.id AND f.status = 'confirmed'
      JOIN LATERAL (
        SELECT count(*) AS rows,
          count(*) FILTER (WHERE r.corrected_values IS NOT NULL) AS corrected,
          count(*) FILTER (WHERE r.status = 'rejected') AS rejected
        FROM import_row_result r WHERE r.import_file_id = f.id) rc ON TRUE
      WHERE sv.part_node_id = ANY(${uuids(ids)})
        AND NOT EXISTS (SELECT 1 FROM source_version nx WHERE nx.previous_version_id = sv.id)
      GROUP BY 1`;
    for (const q of quality) {
      const m = own.get(q.id)!;
      m.quality.files = q.files;
      m.quality.qualitySum = q.quality_sum;
      m.quality.rowsExtracted = q.rows;
      m.quality.rowsCorrected = q.corrected;
      m.quality.rowsRejected = q.rejected;
    }
  }
}

async function upsert(
  tx: Tx,
  rows: { nodeId: string; programId: string; own: RawMetrics; metrics: RawMetrics }[],
  computedAt: Date,
): Promise<void> {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${r.nodeId}::uuid, ${r.programId}::uuid, ${JSON.stringify(r.own)}::jsonb,
                  ${JSON.stringify(r.metrics)}::jsonb, ${computedAt})`,
  );
  await tx.$executeRaw`
    INSERT INTO node_stats (node_id, program_id, own, metrics, computed_at)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (node_id) DO UPDATE
      SET own = EXCLUDED.own, metrics = EXCLUDED.metrics, computed_at = EXCLUDED.computed_at`;
}
