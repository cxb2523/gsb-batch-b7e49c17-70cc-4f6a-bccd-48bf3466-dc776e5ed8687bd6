import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fixtureProject, fixtureWorkspace } from '@/test/management-api';
import type { Workspace } from '@/features/workspaces/schemas';
import type { Project } from '../schemas';
import { useDueKeyRotation } from './useDueKeyRotation';

const mocks = vi.hoisted(() => ({
  rotateWorkspaceKey: vi.fn(),
  rotateDueProjects: vi.fn(),
  session: { data: null as { user: { id: string } } | null },
}));

vi.mock('@/lib/keys', async () => ({
  rotateWorkspaceKey: mocks.rotateWorkspaceKey,
  rotateDueProjects: mocks.rotateDueProjects,
  KeyServiceError: (await import('@/lib/keys/errors')).KeyServiceError,
}));
vi.mock('@/context/KeyContext', () => ({ useKeyContext: () => ({ privateKey: null }) }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => mocks.session }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const dueWorkspace: Workspace = {
  ...fixtureWorkspace,
  encryptedOrgKey: 'org-key',
  keyRotationDue: true,
};
const dueProject: Project = { ...fixtureProject, keyRotationDue: true };

interface Props {
  workspace: Workspace | undefined;
  projects: Project[];
  isAdministrator: boolean;
}

function renderRotation(initial: Partial<Props> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: Props = {
    workspace: dueWorkspace,
    projects: [dueProject],
    isAdministrator: true,
    ...initial,
  };
  return renderHook(
    (current: Props) => useDueKeyRotation({ ...current, workspaceSlug: 'acme-eng' }),
    {
      initialProps: props,
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.data = { user: { id: 'u1' } };
  mocks.rotateWorkspaceKey.mockResolvedValue({
    keyVersion: 2,
    newEncryptedOrgKey: 'new-org-key',
    rewrappedProjects: [{ id: 'p1', encryptedProjectKey: 'rewrapped' }],
  });
  mocks.rotateDueProjects.mockResolvedValue({ rotated: ['p1'], failed: null });
});

describe('useDueKeyRotation', () => {
  it('rotates the workspace key before the projects', async () => {
    const order: string[] = [];
    mocks.rotateWorkspaceKey.mockImplementation(async () => {
      order.push('workspace');
      return { keyVersion: 2, newEncryptedOrgKey: 'new-org-key', rewrappedProjects: [] };
    });
    mocks.rotateDueProjects.mockImplementation(async () => {
      order.push('projects');
      return { rotated: ['p1'], failed: null };
    });

    const { result } = renderRotation();

    await waitFor(() => expect(mocks.rotateDueProjects).toHaveBeenCalledOnce());
    expect(order).toEqual(['workspace', 'projects']);
    expect(mocks.rotateDueProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: { id: 'org-1', keyVersion: 2, encryptedOrgKey: 'new-org-key' },
      }),
    );
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('runs once per workspace even when it re-renders with new data', async () => {
    const { rerender } = renderRotation();
    await waitFor(() => expect(mocks.rotateDueProjects).toHaveBeenCalledOnce());

    rerender({ workspace: dueWorkspace, projects: [{ ...dueProject }], isAdministrator: true });
    rerender({ workspace: dueWorkspace, projects: [{ ...dueProject }], isAdministrator: true });
    await Promise.resolve();

    expect(mocks.rotateWorkspaceKey).toHaveBeenCalledOnce();
    expect(mocks.rotateDueProjects).toHaveBeenCalledOnce();
  });

  it('does nothing for someone who is not an administrator', async () => {
    renderRotation({ isAdministrator: false });
    await Promise.resolve();

    expect(mocks.rotateWorkspaceKey).not.toHaveBeenCalled();
    expect(mocks.rotateDueProjects).not.toHaveBeenCalled();
  });

  it('waits for the session user and then runs', async () => {
    mocks.session.data = null;
    const { rerender } = renderRotation();
    await Promise.resolve();
    expect(mocks.rotateWorkspaceKey).not.toHaveBeenCalled();

    mocks.session.data = { user: { id: 'u1' } };
    rerender({ workspace: dueWorkspace, projects: [dueProject], isAdministrator: true });

    await waitFor(() => expect(mocks.rotateWorkspaceKey).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.rotateDueProjects).toHaveBeenCalledOnce());
  });

  it('reports a failing project rotation and clears the progress notice', async () => {
    mocks.rotateDueProjects.mockRejectedValue(new Error('network down'));

    const { result } = renderRotation();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not secure every project. network down'),
    );
    await waitFor(() => expect(result.current).toBeNull());
  });
});
