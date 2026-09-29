import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApiClient, newIdempotencyKey } from '../dist/index.js';

/** A fetch that records the request and answers with `body`. */
function fakeFetch(body, status = 200) {
  const calls = [];
  const fetch = async (request) => {
    calls.push(request);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch, calls };
}

test('sends the token, the path and the query, and returns the body', async () => {
  const { fetch, calls } = fakeFetch({ items: [], nextCursor: null });
  const api = createApiClient({ baseUrl: 'http://api.test', fetch, getAccessToken: () => 'tok' });
  const { data, error } = await api.GET('/v1/households', {
    params: { query: { q: '16-64', limit: 5 } },
  });
  assert.equal(error, undefined);
  assert.deepEqual(data, { items: [], nextCursor: null });
  assert.equal(calls[0].url, 'http://api.test/v1/households?q=16-64&limit=5');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer tok');
});

test('fills path parameters and the Idempotency-Key header', async () => {
  const { fetch, calls } = fakeFetch({ id: 'h1' }, 201);
  const api = createApiClient({ baseUrl: 'http://api.test', fetch });
  const key = newIdempotencyKey();
  await api.POST('/v1/households/{id}/members', {
    params: { path: { id: 'h1' }, header: { 'Idempotency-Key': key } },
    body: { name: 'Synthetic Person' },
  });
  assert.equal(calls[0].url, 'http://api.test/v1/households/h1/members');
  assert.equal(calls[0].headers.get('Idempotency-Key'), key);
  assert.equal(calls[0].headers.get('Authorization'), null);
  assert.match(key, /^[0-9a-f-]{36}$/);
});

test('returns the API error body on failure', async () => {
  const body = { requestId: 'r1', code: 'NOT_FOUND', message: 'Household not found' };
  const { fetch } = fakeFetch(body, 404);
  const api = createApiClient({ baseUrl: 'http://api.test', fetch });
  const { data, error, response } = await api.GET('/v1/households/{id}', {
    params: { path: { id: 'x' } },
  });
  assert.equal(data, undefined);
  assert.equal(response.status, 404);
  assert.deepEqual(error, body);
});
