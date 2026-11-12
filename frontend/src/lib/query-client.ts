import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { ApiError } from './http';

export function handleGlobal401(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const isBoardRoute = path.includes('/board/') || path.startsWith('/share/');
      const isPublicOrAuth =
        path === '/login' || path === '/signup' || path === '/' || path.startsWith('/invite/');
      if (!isBoardRoute && !isPublicOrAuth) {
        const next = encodeURIComponent(path + window.location.search);
        window.location.href = `/login?next=${next}`;
      }
    }
  }
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
    if (
      error.code === 'STALE_KEY_VERSION' ||
      error.code === 'KEY_ROTATED' ||
      error.code === 'WORKSPACE_ROTATION_PENDING' ||
      error.code === 'UNEXPECTED_RESPONSE'
    ) {
      return false;
    }
  }
  return true;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleGlobal401,
  }),
  mutationCache: new MutationCache({
    onError: handleGlobal401,
  }),
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: shouldRetry,
    },
  },
});
