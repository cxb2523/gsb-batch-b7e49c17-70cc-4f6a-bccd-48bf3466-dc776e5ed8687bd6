import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/http';
import { ProjectSchema } from '@/features/projects/schemas';
import { WorkspaceSchema } from '@/features/workspaces/schemas';
import { createBoard } from '../api';
import { useCreateCanvas } from './useCreateCanvas';

vi.mock('../api', () => ({ createBoard: vi.fn() }));

vi.mock('@/lib/keys', () => ({
  resolveProjectKey: vi.fn().mockResolvedValue({}),
  provisionBoardKeys: vi.fn().mockResolvedValue({ encryptedBoardKey: 'wrapped-board-key' }),
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u1' } } }),
}));

vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ privateKey: null }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const workspace = WorkspaceSchema.parse({ id: 'w1', name: 'Acme', slug: 'acme', keyVersion: 1 });
const project = ProjectSchema.parse({ id: 'p1', name: 'Docs', keyVersion: 1 });

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('useCreateCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the instance limit message when the server refuses the canvas', async () => {
    const message =
      'This instance allows 10 boards per account. Ask the instance operator to raise the limit.';
    vi.mocked(createBoard).mockRejectedValueOnce(
      new ApiError({ status: 403, code: 'LIMIT_REACHED', message }),
    );
    const { result } = renderHook(() => useCreateCanvas(workspace, project, 'acme'), { wrapper });

    await act(async () => {
      await result.current.create();
    });

    expect(toast.error).toHaveBeenCalledWith(message);
    expect(result.current.isCreating).toBe(false);
  });
});
