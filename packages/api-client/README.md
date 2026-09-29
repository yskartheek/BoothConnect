# @boothconnect/api-client

A typed client for the BoothConnect API, generated from
`docs/api/openapi.json` with
[openapi-typescript](https://openapi-ts.dev) and used through
[openapi-fetch](https://openapi-ts.dev/openapi-fetch/).

```ts
import { createApiClient, newIdempotencyKey } from '@boothconnect/api-client';

const api = createApiClient({ baseUrl: 'http://localhost:4000', getAccessToken: () => token });

const { data, error } = await api.GET('/v1/households/{id}', { params: { path: { id } } });
// data: Schemas['HouseholdDetail'] | undefined; error: ApiError | undefined

await api.POST('/v1/visits', {
  params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
  body: { clientId, householdId, startedAt, outcome: 'completed', formVersion: '2026.1' },
});
```

Paths, parameters, bodies and responses are checked by TypeScript. A path
that doesn't exist, or a missing field, is a compile error.

## When the API changes

1. `pnpm --filter api openapi` rewrites `docs/api/openapi.json`.
2. `pnpm --filter @boothconnect/api-client generate` rewrites
   `src/schema.ts`.
3. Commit both.

CI fails if either is out of date: the "OpenAPI spec is up to date" step,
and this package's `test`.
