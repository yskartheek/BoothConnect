import { ApiRequestError } from '@/lib/api';

import { createQueryClient } from './providers';

describe('query defaults', () => {
  const retry = createQueryClient().getDefaultOptions().queries!.retry as (
    failures: number,
    error: unknown,
  ) => boolean;

  it('retries server and network errors twice', () => {
    const error = new ApiRequestError(503, { code: 'SERVICE_UNAVAILABLE' });
    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(true);
    expect(retry(2, error)).toBe(false);
    expect(retry(0, new ApiRequestError(0, null))).toBe(true);
  });

  it('never retries a client error', () => {
    expect(retry(0, new ApiRequestError(403, { code: 'FORBIDDEN' }))).toBe(false);
    expect(retry(0, new ApiRequestError(404, { code: 'NOT_FOUND' }))).toBe(false);
  });
});
