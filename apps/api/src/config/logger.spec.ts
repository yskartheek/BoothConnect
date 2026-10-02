import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  LOGGABLE_QUERY_PARAMS,
  REQUEST_ID_HEADER,
  redactQuery,
  redactUrl,
  resolveRequestId,
  serializeRequest,
} from './logger';

function call(header?: string): { id: string; sent: unknown } {
  const req = { headers: header === undefined ? {} : { [REQUEST_ID_HEADER]: header } };
  let sent: unknown;
  const res = { setHeader: (_name: string, value: unknown) => (sent = value) };
  const id = resolveRequestId(req as IncomingMessage, res as unknown as ServerResponse);
  return { id, sent };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('generates a UUID and returns it in the response header', () => {
    const { id, sent } = call();
    expect(id).toMatch(UUID);
    expect(sent).toBe(id);
  });

  it('keeps a well-formed caller-supplied ID', () => {
    expect(call('mobile-7f3a.42').id).toBe('mobile-7f3a.42');
  });

  it.each(['has spaces', 'line\nbreak', 'x'.repeat(129), ''])(
    'replaces an unsafe ID (%j)',
    (header) => {
      expect(call(header).id).toMatch(UUID);
    },
  );
});

// #210: search terms can be personal data (a voter's name, house number,
// phone). Synthetic values only.
describe('request log redaction', () => {
  it('redacts free-text search and keeps IDs, cursors and flags', () => {
    expect(
      redactUrl('/v1/households?boothId=b-1&q=Synthetic%20Lakshmi&status=active&limit=20'),
    ).toBe('/v1/households?boothId=b-1&q=[redacted]&status=active&limit=20');
    expect(redactQuery({ q: '+919999900101', since: 'c-9', history: 'true' })).toEqual({
      q: '[redacted]',
      since: 'c-9',
      history: 'true',
    });
  });

  it('redacts a parameter it doesn’t know', () => {
    expect(redactUrl('/v1/x?name=Synthetic+Ravi')).toBe('/v1/x?name=[redacted]');
    expect(redactQuery({ phone: '+919999900101' })).toEqual({ phone: '[redacted]' });
  });

  it('redacts every value of a repeated parameter, and keeps the path', () => {
    expect(redactUrl('/v1/voters/v-1?q=a&q=b')).toBe('/v1/voters/v-1?q=[redacted]&q=[redacted]');
    expect(redactQuery({ q: ['a', 'b'] })).toEqual({ q: '[redacted]' });
    expect(redactUrl('/v1/households')).toBe('/v1/households');
  });

  it('handles an absolute URL and drops the fragment', () => {
    expect(redactUrl('http://localhost:3000/voters?q=Synthetic+Lakshmi#row-3')).toBe(
      'http://localhost:3000/voters?q=[redacted]',
    );
    expect(redactUrl('/v1/households#q=Synthetic')).toBe('/v1/households');
    expect(redactUrl(undefined)).toBeUndefined();
  });

  it('keeps an allowed value encoded, so it can’t break the line', () => {
    expect(redactUrl('/v1/audit-events?from=2026-10-01T00:00:00%2B05:30')).toBe(
      '/v1/audit-events?from=2026-10-01T00%3A00%3A00%2B05%3A30',
    );
  });

  it('serializes a request without the search in its URL, query or Referer', () => {
    const logged = serializeRequest({
      id: 'r-1',
      method: 'GET',
      url: '/v1/households?q=Synthetic%20Lakshmi',
      query: { q: 'Synthetic Lakshmi' },
      params: {},
      headers: {
        referer: 'http://localhost:3000/voters?q=Synthetic+Lakshmi',
        'user-agent': 'test',
      },
    });
    expect(JSON.stringify(logged)).not.toMatch(/Lakshmi/);
    expect(logged).toMatchObject({
      id: 'r-1',
      method: 'GET',
      headers: { 'user-agent': 'test' },
    });
    expect(serializeRequest({ url: '/v1/me' })).toEqual({ url: '/v1/me', query: {} });
  });

  it('lists only parameters whose values are IDs, codes, dates, numbers or flags', () => {
    for (const name of ['q', 'name', 'phone', 'search', 'address']) {
      expect(LOGGABLE_QUERY_PARAMS.has(name)).toBe(false);
    }
  });
});
