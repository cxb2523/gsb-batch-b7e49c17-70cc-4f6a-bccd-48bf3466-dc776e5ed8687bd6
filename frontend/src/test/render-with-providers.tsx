import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataRouter } from './data-router';

/** Renders under a fresh QueryClient (no retries, so failures surface at once) and a router. */
export function renderWithProviders(ui: ReactElement, route = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DataRouter route={route}>{ui}</DataRouter>
    </QueryClientProvider>,
  );
}
