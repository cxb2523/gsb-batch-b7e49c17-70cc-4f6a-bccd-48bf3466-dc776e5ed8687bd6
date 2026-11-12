import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useKeyRotation } from './useKeyRotation';
import { KeyServiceError } from '@/lib/keys/errors';
import { fixtureProject, fixtureWorkspace } from '@/test/management-api';

const keys = vi.hoisted(() => ({
  rotateWorkspaceKey: vi.fn(),
  rotateDueProjects: vi.fn(),
}));

vi.mock('@/lib/keys', async () => ({
  ...keys,
  KeyServiceError: (await import('@/lib/keys/errors')).KeyServiceError,
}));
vi.mock('@/context/KeyContext', () => ({ useKeyContext: () => ({ privateKey: null }) }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderRotation(isAdministrator = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(
    () =>
      useKeyRotation({
        workspace: { ...fixtureWorkspace, encryptedOrgKey: 'org-key' },
        projects: [fixtureProject],
        isAdministrator,
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  keys.rotateWorkspaceKey.mockResolvedValue({
    keyVersion: 2,
    newEncryptedOrgKey: 'new-org-key',
    rewrappedProjects: [{ id: 'p1', encryptedProjectKey: 'rewrapped' }],
  });
  keys.rotateDueProjects.mockResolvedValue({ rotated: ['p1'], failed: null });
});

describe('useKeyRotation', () => {
  it('re-keys the workspace first, then the flagged projects under the new key', async () => {
    const { result } = renderRotation();

    await act(() => result.current.runRotation(['p1'], true));

    expect(keys.rotateWorkspaceKey).toHaveBeenCalledOnce();
    expect(keys.rotateDueProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: { id: 'org-1', keyVersion: 2, encryptedOrgKey: 'new-org-key' },
        projects: [expect.objectContaining({ id: 'p1', encryptedProjectKey: 'rewrapped' })],
      }),
    );
    expect(result.current.rotationProgress).toBeNull();
  });

  it('only re-keys projects when the workspace does not need it', async () => {
    const { result } = renderRotation();

    await act(() => result.current.runRotation(['p1']));

    expect(keys.rotateWorkspaceKey).not.toHaveBeenCalled();
    expect(keys.rotateDueProjects).toHaveBeenCalledOnce();
  });

  it('stops and says so when the workspace key cannot be rotated', async () => {
    keys.rotateWorkspaceKey.mockRejectedValue(new KeyServiceError('locked', 'Unlock first'));
    const { result } = renderRotation();

    await act(() => result.current.runRotation(['p1'], true));

    expect(toast.error).toHaveBeenCalledWith('Could not secure workspace. Unlock first');
    expect(keys.rotateDueProjects).not.toHaveBeenCalled();
    expect(result.current.rotationProgress).toBeNull();
  });

  it('reports the projects that could not be re-keyed', async () => {
    keys.rotateDueProjects.mockResolvedValue({ rotated: [], failed: 'Core Architecture' });
    const { result } = renderRotation();

    await act(() => result.current.runRotation(['p1']));

    expect(toast.error).toHaveBeenCalledWith('Could not secure every project. Core Architecture');
  });

  it('clears the progress notice and reports an unexpected failure', async () => {
    keys.rotateDueProjects.mockRejectedValue(new Error('network down'));
    const { result } = renderRotation();

    await act(() => result.current.runRotation(['p1']));

    expect(toast.error).toHaveBeenCalledWith('Could not secure every project. network down');
    expect(result.current.rotationProgress).toBeNull();
  });

  it('does nothing for someone who is not an administrator', async () => {
    const { result } = renderRotation(false);

    await act(() => result.current.runRotation(['p1'], true));

    expect(keys.rotateWorkspaceKey).not.toHaveBeenCalled();
    expect(keys.rotateDueProjects).not.toHaveBeenCalled();
  });
});
