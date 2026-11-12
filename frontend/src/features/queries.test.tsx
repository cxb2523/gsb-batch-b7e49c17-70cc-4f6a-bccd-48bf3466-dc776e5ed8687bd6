import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useProjects, useProjectMembers } from './projects/queries';
import { useWorkspaceMembers, useWorkspaceInvitations } from './members/queries';
import { useBoards } from './boards/queries';

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectMembers: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  listWorkspaceInvitations: vi.fn(),
  listBoards: vi.fn(),
}));

vi.mock('./projects/api', () => ({
  listProjects: api.listProjects,
  listProjectMembers: api.listProjectMembers,
}));
vi.mock('./members/api', () => ({
  listWorkspaceMembers: api.listWorkspaceMembers,
  listWorkspaceInvitations: api.listWorkspaceInvitations,
}));
vi.mock('./boards/api', () => ({ listBoards: api.listBoards }));

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const neverSettles = new Promise<never>(() => {});

describe('server state is scoped to the workspace it was read for', () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it.each([
    ['projects', (id: string) => useProjects(id), api.listProjects],
    ['project members', (id: string) => useProjectMembers(id, 'p1'), api.listProjectMembers],
    ['workspace members', (id: string) => useWorkspaceMembers(id), api.listWorkspaceMembers],
    ['invitations', (id: string) => useWorkspaceInvitations(id), api.listWorkspaceInvitations],
    ['boards', (id: string) => useBoards(id), api.listBoards],
  ])('%s of workspace A are never shown while workspace B loads', async (_name, hook, list) => {
    const rowsOfA = [{ id: 'only-in-a' }];
    list.mockResolvedValueOnce(rowsOfA).mockReturnValueOnce(neverSettles);

    const { result, rerender } = renderHook(({ id }) => hook(id), {
      wrapper: wrapperFor(client),
      initialProps: { id: 'ws-a' },
    });
    await waitFor(() => expect(result.current.data).toEqual(rowsOfA));

    rerender({ id: 'ws-b' });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toBe('ws-b'));
  });
});
