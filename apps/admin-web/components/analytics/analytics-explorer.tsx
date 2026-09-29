'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { LEVEL } from '@/lib/geography';
import { t } from '@/lib/i18n';

import { AreaPicker, type AreaNode, placeLabel, useAdminAreas } from '../area-picker';
import { EmptyState, ErrorState, LoadingState } from '../states';
import {
  AGE_BAND_KEYS,
  type Breakdown,
  describeFigure,
  farFromAverage,
  type Figure,
  formatFigure,
  label,
  sortChildren,
  type Summary,
} from './figures';

export const analyticsUrl = (nodeId: string) => `/analytics?node=${encodeURIComponent(nodeId)}`;

const getNode = (id: string) =>
  unwrap(apiClient().GET('/v1/geographies/{id}', { params: { path: { id } } }));
const getSummary = (id: string) =>
  unwrap(apiClient().GET('/v1/analytics/nodes/{id}/summary', { params: { path: { id } } }));
const getChildren = (id: string) =>
  unwrap(apiClient().GET('/v1/analytics/nodes/{id}/children', { params: { path: { id } } }));

/**
 * The analytics explorer (#74; design §7): any node of the admin's area,
 * from the State down to a polling station. The node is in the address
 * (`?node=`); without one, the admin's own area opens.
 */
export function AnalyticsExplorer({ nodeId }: { nodeId?: string }) {
  const router = useRouter();
  const areas = useAdminAreas();
  const [path, setPath] = useState<AreaNode[]>([]);
  const current = nodeId ?? areas.data?.areas[0]?.id;

  return (
    <>
      <section className="glass section" aria-labelledby="analytics-go">
        <h2 id="analytics-go" className="visually-hidden">
          {t('analytics.goTitle')}
        </h2>
        <form
          className="form form-inline analytics-go"
          onSubmit={(event) => {
            event.preventDefault();
            const target = path.at(-1);
            if (target) router.push(analyticsUrl(target.id));
          }}
        >
          <AreaPicker
            legend={t('analytics.goLegend')}
            path={path}
            emptyLabel={t('analytics.choose')}
            onChange={setPath}
          />
          <button type="submit" className="button" disabled={path.length === 0}>
            {t('analytics.show')}
          </button>
        </form>
      </section>
      {current ? (
        <NodeAnalytics key={current} nodeId={current} />
      ) : areas.isPending ? (
        <LoadingState />
      ) : areas.isError ? (
        <ErrorState error={areas.error} onRetry={() => void areas.refetch()} />
      ) : (
        <EmptyState title={t('analytics.noArea')} />
      )}
    </>
  );
}

function NodeAnalytics({ nodeId }: { nodeId: string }) {
  const node = useQuery({
    queryKey: ['geography', 'node', nodeId],
    queryFn: () => getNode(nodeId),
  });
  const summary = useQuery({
    queryKey: ['analytics', 'summary', nodeId],
    queryFn: () => getSummary(nodeId),
  });
  const parentId = node.data?.parentId ?? null;
  // The parent, for comparison; above the admin's area it's 404, and not shown.
  const parent = useQuery({
    queryKey: ['analytics', 'summary', parentId],
    queryFn: () => getSummary(parentId!),
    enabled: parentId !== null,
    retry: false,
  });
  const hasChildren = node.data && node.data.type !== 'polling_station';

  if (node.isPending || summary.isPending) return <LoadingState />;
  const failed = node.error ?? summary.error;
  if (failed) {
    // Not in the area, or an address that isn't a node id.
    if (failed instanceof ApiRequestError && (failed.status === 404 || failed.status === 400)) {
      return <EmptyState title={t('analytics.outsideArea')} />;
    }
    return (
      <ErrorState
        error={failed}
        onRetry={() => {
          void node.refetch();
          void summary.refetch();
        }}
      />
    );
  }

  const data = summary.data!;
  const place = node.data!;
  return (
    <>
      <Breadcrumbs path={place.path} node={place} />
      <section className="glass section" aria-labelledby="analytics-node">
        <h2 id="analytics-node">{placeLabel(place)}</h2>
        <p className="muted">
          {data.computedAt
            ? t('analytics.updatedAt', {
                time: new Date(data.computedAt).toLocaleString('en-IN'),
              })
            : t('analytics.notComputed')}
        </p>
        <MetricCards summary={data} />
        {parent.data ? <Comparison node={data} parent={parent.data} /> : null}
      </section>
      {hasChildren ? <ChildrenSection nodeId={nodeId} /> : null}
    </>
  );
}

/** State › PC › AC › Part › Station; places in the admin's area link to their analytics. */
function Breadcrumbs({ path, node }: { path: AreaNode[]; node: AreaNode }) {
  const areas = useAdminAreas();
  const roots = new Set(areas.data?.areas.map((a) => a.id) ?? []);
  const all = [...path, node];
  // From the admin's own node down, a place is in their area.
  const firstInArea = all.findIndex((n) => roots.has(n.id));
  return (
    <nav aria-label={t('analytics.breadcrumbs')} className="breadcrumb">
      <ol>
        {all.map((n, i) => (
          <li key={n.id} aria-current={i === all.length - 1 ? 'page' : undefined}>
            {i < all.length - 1 && firstInArea !== -1 && i >= firstInArea ? (
              <Link href={analyticsUrl(n.id)}>{placeLabel(n)}</Link>
            ) : (
              placeLabel(n)
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One figure with its definition (design §7: every card shows what it means). */
function FigureItem({
  figureKey,
  value,
  summary,
}: {
  figureKey: string;
  value: Figure;
  summary: Summary;
}) {
  const id = useId();
  const help = describeFigure(value, summary.minCohort);
  const definition = summary.definitions[figureKey];
  return (
    <div className="figure-item">
      <dt>{label(figureKey)}</dt>
      <dd
        className={typeof value === 'number' ? 'figure-value' : 'figure-value figure-missing'}
        aria-describedby={`${id}-help`}
      >
        {formatFigure(figureKey, value, summary.minCohort)}
      </dd>
      <dd id={`${id}-help`} className="figure-help">
        {[help, definition].filter(Boolean).join(' ')}
      </dd>
    </div>
  );
}

const CARDS: { title: Parameters<typeof t>[0]; keys: string[]; chart?: string[] }[] = [
  {
    title: 'analytics.cardElectors',
    keys: [
      'electors.total',
      'electors.male',
      'electors.female',
      'electors.thirdGender',
      'genderRatio',
    ],
    chart: ['electors.male', 'electors.female', 'electors.thirdGender', 'electors.unknown'],
  },
  {
    title: 'analytics.cardAges',
    keys: ['medianAge', 'ages.18-19'],
    chart: [...AGE_BAND_KEYS, 'ages.unknown'],
  },
  {
    title: 'analytics.cardHouseholds',
    keys: ['households.total', 'votersPerHousehold', 'households.large'],
  },
  {
    title: 'analytics.cardRevisions',
    keys: ['revisions.additions', 'revisions.deletions', 'revisions.net'],
  },
  {
    title: 'analytics.cardQuality',
    keys: [
      'extractionQuality',
      'quality.rowsExtracted',
      'quality.rowsCorrected',
      'quality.rowsRejected',
      'quality.missingAge',
      'quality.missingGender',
    ],
  },
  {
    title: 'analytics.cardFieldWork',
    keys: [
      'fieldWork.householdsAssigned',
      'fieldWork.householdsVisited',
      'visitedShare',
      'fieldWork.votersMet',
    ],
  },
];

function MetricCards({ summary }: { summary: Summary }) {
  return (
    <div className="metric-cards">
      {CARDS.map((card) => (
        <article key={card.title} className="metric-card" aria-label={t(card.title)}>
          <h3>{t(card.title)}</h3>
          <dl>
            {card.keys.map((key) => (
              <FigureItem
                key={key}
                figureKey={key}
                value={(summary.metrics[key] ?? null) as Figure}
                summary={summary}
              />
            ))}
          </dl>
          {card.chart ? <Bars keys={card.chart} summary={summary} title={t(card.title)} /> : null}
        </article>
      ))}
    </div>
  );
}

/**
 * A single-series bar chart: one bar per category, labelled with its value
 * in text colour. Suppressed or missing categories get no bar, only their
 * label ("<10", "Not collected"): never a zero-length bar that reads as 0.
 */
function Bars({ keys, summary, title }: { keys: string[]; summary: Summary; title: string }) {
  const values = keys.map((key) => (summary.metrics[key] ?? null) as Figure);
  const max = Math.max(1, ...values.map((v) => (typeof v === 'number' ? v : 0)));
  return (
    <figure className="bars" aria-label={t('analytics.chartOf', { title })}>
      {keys.map((key, i) => {
        const value = values[i]!;
        const text = formatFigure(key, value, summary.minCohort);
        return (
          <div key={key} className="bar-row" title={`${label(key)}: ${text}`}>
            <span className="bar-label">{label(key)}</span>
            <span className="bar-track" aria-hidden="true">
              {typeof value === 'number' && value > 0 ? (
                <span className="bar-fill" style={{ width: `${(value / max) * 100}%` }} />
              ) : null}
            </span>
            <span className="bar-value">{text}</span>
          </div>
        );
      })}
    </figure>
  );
}

const COMPARED = [
  'genderRatio',
  'medianAge',
  'votersPerHousehold',
  'extractionQuality',
  'visitedShare',
];

/** This node's ratios next to its parent's, e.g. "gender ratio 962 vs AC 981". */
function Comparison({ node, parent }: { node: Summary; parent: Summary }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="table-caption">
          {t('analytics.comparedWith', { parent: placeLabel(parent.node) })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('analytics.figure')}</th>
            <th scope="col">{placeLabel(node.node)}</th>
            <th scope="col">{placeLabel(parent.node)}</th>
          </tr>
        </thead>
        <tbody>
          {COMPARED.map((key) => (
            <tr key={key}>
              <th scope="row">{label(key)}</th>
              <td>{formatFigure(key, (node.metrics[key] ?? null) as Figure, node.minCohort)}</td>
              <td>
                {formatFigure(key, (parent.metrics[key] ?? null) as Figure, parent.minCohort)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The columns of the children table. */
export const CHILD_COLUMNS = [
  'electors.total',
  'genderRatio',
  'ages.18-19',
  'medianAge',
  'households.total',
  'votersPerHousehold',
  'revisions.net',
  'extractionQuality',
  'visitedShare',
];

/**
 * Parent analysis: every child with its figures, sortable, with the
 * parent's total and average; figures more than 25% from the average are
 * marked. A child's name drills down to it.
 */
function ChildrenSection({ nodeId }: { nodeId: string }) {
  const children = useQuery({
    queryKey: ['analytics', 'children', nodeId],
    queryFn: () => getChildren(nodeId),
  });
  if (children.isPending) return <LoadingState />;
  if (children.isError) {
    return <ErrorState error={children.error} onRetry={() => void children.refetch()} />;
  }
  if (children.data.children.length === 0) return null;
  return <ChildrenTable breakdown={children.data} />;
}

export function ChildrenTable({ breakdown }: { breakdown: Breakdown }) {
  const id = useId();
  const [sort, setSort] = useState<{ key: string | null; order: 'asc' | 'desc' }>({
    key: null,
    order: 'desc',
  });
  const rows = sortChildren(breakdown.children, sort.key, sort.order);
  const level = breakdown.children[0]!.node.type;
  const toggle = (key: string) =>
    setSort((s) =>
      s.key === key ? { key, order: s.order === 'desc' ? 'asc' : 'desc' } : { key, order: 'desc' },
    );
  const figure = (metrics: Record<string, Figure>, key: string) => (metrics[key] ?? null) as Figure;

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        {t('analytics.childrenTitle', { level: t(LEVEL[level]), count: breakdown.children.length })}
      </h2>
      <div className="table-wrap">
        <table className="table children-table">
          <caption className="visually-hidden">{t('analytics.childrenCaption')}</caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={sort.key === null ? 'ascending' : 'none'}>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => setSort({ key: null, order: 'asc' })}
                >
                  {t(LEVEL[level])}
                </button>
              </th>
              {CHILD_COLUMNS.map((key) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={
                    sort.key === key ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button type="button" className="sort-button" onClick={() => toggle(key)}>
                    {label(key)}
                    <span aria-hidden="true">
                      {sort.key === key ? (sort.order === 'asc' ? ' ▲' : ' ▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((child) => (
              <tr key={child.node.id}>
                <th scope="row">
                  <Link href={analyticsUrl(child.node.id)}>
                    {child.node.code} {child.node.name}
                  </Link>
                </th>
                {CHILD_COLUMNS.map((key) => {
                  const value = figure(child.metrics, key);
                  const far = farFromAverage(value, figure(breakdown.average, key));
                  return (
                    <td key={key} className={far ? 'far-from-average' : undefined}>
                      {formatFigure(key, value, breakdown.minCohort)}
                      {far ? (
                        <span className="visually-hidden"> ({t('analytics.farFromAverage')})</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t('analytics.total')}</th>
              {CHILD_COLUMNS.map((key) => (
                <td key={key}>
                  {formatFigure(key, figure(breakdown.total, key), breakdown.minCohort)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">{t('analytics.average')}</th>
              {CHILD_COLUMNS.map((key) => (
                <td key={key}>
                  {formatFigure(key, figure(breakdown.average, key), breakdown.minCohort)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted">{t('analytics.farHint')}</p>
    </section>
  );
}
