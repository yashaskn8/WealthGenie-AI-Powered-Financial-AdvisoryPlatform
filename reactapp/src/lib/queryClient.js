import { QueryClient } from '@tanstack/react-query';

const isRetryableRead = (failureCount, error) => {
  if (failureCount >= 1) return false;
  return Boolean(error?.retryable) && error?.status !== 401;
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: isRetryableRead,
    },
    mutations: {
      // Authoritative financial writes already have server-side idempotency.
      // Retrying them in the browser can create duplicate user intent.
      retry: false,
    },
  },
});

export const profileQueryKey = ['profile', 'current'];

export const recommendationQueryKey = (profileId) => [
  'recommendation',
  profileId || 'current',
];

export const goalsQueryKey = ['goals'];

export const marketRatesQueryKey = ['market', 'rates'];

export const marketContextQueryKey = ['market', 'context'];
