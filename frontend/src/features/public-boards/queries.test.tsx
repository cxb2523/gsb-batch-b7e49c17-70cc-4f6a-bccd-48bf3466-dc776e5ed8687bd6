import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { errorResponse, jsonResponse } from '@/test/http';
import { usePublicBoard, usePublicBoardPayload } from './queries';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('public board queries', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('reads the metadata behind a share token', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ id: 'b1', title: 'Shared' }));

    const { result } = renderHook(() => usePublicBoard('tok'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.data?.title).toBe('Shared'));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/boards/tok'),
      expect.anything(),
    );
  });

  it('reports a revoked link as a 404', async () => {
    global.fetch = vi.fn(async () => errorResponse(404, 'NOT_FOUND', 'Revoked'));

    const { result } = renderHook(() => usePublicBoard('tok'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.error).toMatchObject({ status: 404 }));
  });

  it('only reads the payload once asked to', async () => {
    global.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const { result, rerender } = renderHook(
      ({ enabled }) => usePublicBoardPayload('tok', enabled),
      { wrapper: wrapperFor(client), initialProps: { enabled: false } },
    );
    expect(global.fetch).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.data?.byteLength).toBe(3));
  });
});
