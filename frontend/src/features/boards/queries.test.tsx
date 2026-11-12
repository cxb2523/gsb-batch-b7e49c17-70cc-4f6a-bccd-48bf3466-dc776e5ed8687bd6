import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { jsonResponse, errorResponse } from '@/test/http';
import { boardKeys } from './keys';
import { useBoard } from './queries';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useBoard', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('reads one board for the workspace it was opened under, normalised for the canvas', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({ id: 'b1', title: 'Mesh', projectId: 'p1', publicShareToken: 'tok' }),
    );

    const { result } = renderHook(() => useBoard('acme', 'b1'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.data?.title).toBe('Mesh'));
    expect(result.current.data?.keyVersion).toBe(1);
    expect(result.current.data?.publicShareToken).toBe('tok');
    // The cache keeps the server's shape, under a key that carries the workspace.
    expect(client.getQueryData(boardKeys.detail('acme', 'b1'))).toMatchObject({ id: 'b1' });
    expect(client.getQueryData(boardKeys.detail('other', 'b1'))).toBeUndefined();
  });

  it('reads the board from the server again when the canvas is opened again, even with a cached copy', async () => {
    // The copy left by an earlier visit says the board was never saved; the server has moved on.
    client.setQueryData(boardKeys.detail('acme', 'b1'), {
      id: 'b1',
      title: 'Mesh',
      projectId: 'p1',
      revision: 0,
      hasPayload: false,
    });
    global.fetch = vi.fn(async () =>
      jsonResponse({
        id: 'b1',
        title: 'Mesh',
        projectId: 'p1',
        revision: 3,
        hasPayload: true,
      }),
    );

    const { result } = renderHook(() => useBoard('acme', 'b1'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isFetchedAfterMount).toBe(true));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.data?.revision).toBe(3);
    expect(result.current.data?.hasPayload).toBe(true);
  });

  it('does not ask the server before it knows which board', () => {
    global.fetch = vi.fn();

    renderHook(() => useBoard('acme', undefined), { wrapper: wrapperFor(client) });
    renderHook(() => useBoard(undefined, 'b1'), { wrapper: wrapperFor(client) });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('exposes the server error so the page can decide what to do', async () => {
    global.fetch = vi.fn(async () => errorResponse(403, 'FORBIDDEN', 'No access'));

    const { result } = renderHook(() => useBoard('acme', 'b1'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.error).toMatchObject({ status: 403 }));
    expect(result.current.data).toBeUndefined();
  });
});
