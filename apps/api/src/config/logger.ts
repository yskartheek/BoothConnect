import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';

import type { Env } from './env';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller-supplied request ID only if it looks like an ID, so log
// lines can't be forged or bloated through the header.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Query parameters whose values are IDs, codes, dates, numbers or flags, so
 * they can be logged as they are. Every other parameter's value, above all
 * free-text search (`q`), is logged as `[redacted]`: a search can hold a
 * voter's name, house number or phone (#210, spec §14 and §20). A new
 * parameter is redacted until it's added here.
 */
export const LOGGABLE_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'action',
  'active',
  'actorId',
  'boothId',
  'cursor',
  'from',
  'history',
  'limit',
  'lowConfidence',
  'metric',
  'nodeId',
  'order',
  'parentId',
  'resourceId',
  'resourceType',
  'result',
  'role',
  'since',
  'status',
  'to',
  'type',
  'verify',
]);

const REDACTED = '[redacted]';

/** A parsed query object with every value not in the allow-list replaced. */
export function redactQuery(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== 'object') return {};
  return Object.fromEntries(
    Object.entries(query).map(([name, value]) => [
      name,
      LOGGABLE_QUERY_PARAMS.has(name) ? value : REDACTED,
    ]),
  );
}

/**
 * A URL (a path, or an absolute URL such as a Referer) with the query
 * string's values redacted as in [redactQuery], and the fragment dropped.
 */
export function redactUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const withoutFragment = url.split('#', 1)[0]!;
  const at = withoutFragment.indexOf('?');
  if (at < 0) return withoutFragment;
  const params = new URLSearchParams(withoutFragment.slice(at + 1));
  const kept = [...params].map(
    ([name, value]) =>
      `${encodeURIComponent(name)}=${LOGGABLE_QUERY_PARAMS.has(name) ? encodeURIComponent(value) : REDACTED}`,
  );
  return `${withoutFragment.slice(0, at)}?${kept.join('&')}`;
}

/** The fields pino-http logs for a request (pino-std-serializers' `req`). */
interface SerializedRequest {
  url?: string;
  query?: unknown;
  headers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The logged request, without personal data in its URL, query or Referer. */
export function serializeRequest(req: SerializedRequest): SerializedRequest {
  const headers = req.headers && {
    ...req.headers,
    ...(typeof req.headers.referer === 'string' ? { referer: redactUrl(req.headers.referer) } : {}),
  };
  return { ...req, url: redactUrl(req.url), query: redactQuery(req.query), headers };
}

export function loggerParams(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: resolveRequestId,
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Human-readable output in development; JSON lines everywhere else.
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
      // The URL, query and Referer without search terms (#210). Path
      // parameters are IDs only, so the path is kept.
      serializers: { req: serializeRequest },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
  };
}
