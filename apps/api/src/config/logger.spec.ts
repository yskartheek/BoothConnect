import type { IncomingMessage, ServerResponse } from 'node:http';

import { REQUEST_ID_HEADER, resolveRequestId } from './logger';

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
