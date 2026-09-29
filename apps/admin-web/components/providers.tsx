'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { ApiRequestError } from '@/lib/api';

/**
 * Query defaults: a failed request is retried twice, except a client error
 * (4xx: the same request would fail the same way, e.g. 403 or 404).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failures, error) =>
          !(error instanceof ApiRequestError && error.isClientError) && failures < 2,
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
