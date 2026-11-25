import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (count, error) => {
        const status = 'status' in error ? Number(error.status) : 0;
        return count < 1 && (status === 0 || status >= 500);
      },
    },
    mutations: { retry: false },
  },
});
