import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyServiceError } from '@/lib/keys/errors';
import { rotateWorkspaceThenProjects, rotationDueIds, toRotationProjects } from './rotation';

const keys = vi.hoisted(() => ({
  rotateWorkspaceKey: vi.fn(),
  rotateDueProjects: vi.fn(),
}));

vi.mock('@/lib/keys', async () => ({
  ...keys,
  KeyServiceError: (await import('@/lib/keys/errors')).KeyServiceError,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('rotationDueIds', () => {
  it('reads the ids the server flagged', () => {
    expect(rotationDueIds({ rotationDue: ['p1', 7, 'p2'] })).toEqual(['p1', 'p2']);
  });

  it('is null when the response carries no rotation list', () => {
    expect(rotationDueIds(undefined)).toBeNull();
    expect(rotationDueIds({})).toBeNull();
    expect(rotationDueIds({ rotationDue: 'p1' })).toBeNull();
  });
});

describe('toRotationProjects', () => {
  it('keeps due projects that have a key version', () => {
    const projects = [
      { id: 'a', keyVersion: 1, encryptedProjectKey: 'k' },
      { id: 'b', keyVersion: 2 },
      { id: 'c', keyVersion: null },
    ];

    expect(toRotationProjects(projects, () => true)).toEqual([
      { id: 'a', keyVersion: 1, keyRotationDue: true, encryptedProjectKey: 'k' },
      { id: 'b', keyVersion: 2, keyRotationDue: true, encryptedProjectKey: null },
    ]);
    expect(toRotationProjects(projects, (p) => p.id === 'b')).toHaveLength(1);
  });
});

describe('rotateWorkspaceThenProjects', () => {
  const queryClient = new QueryClient();
  const progress: (string | null)[] = [];
  const run = (overrides: Partial<Parameters<typeof rotateWorkspaceThenProjects>[0]> = {}) =>
    rotateWorkspaceThenProjects({
      workspace: { id: 'org-1', keyVersion: 1, encryptedOrgKey: 'org-key' },
      rotateWorkspace: true,
      projects: [{ id: 'p1', keyVersion: 1, keyRotationDue: true, encryptedProjectKey: 'old' }],
      privateKey: null,
      userId: 'u1',
      queryClient,
      invalidate: { workspace: ['workspace'], projects: ['projects'], rekeyQueue: ['rekey-queue'] },
      onProgress: (label) => progress.push(label),
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    progress.length = 0;
    keys.rotateWorkspaceKey.mockResolvedValue({
      keyVersion: 2,
      newEncryptedOrgKey: 'new-org-key',
      rewrappedProjects: [{ id: 'p1', encryptedProjectKey: 'rewrapped' }],
    });
    keys.rotateDueProjects.mockResolvedValue({ rotated: ['p1'], failed: null });
  });

  it('rotates the projects under the re-wrapped keys and the new workspace key', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await run();

    expect(keys.rotateDueProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: { id: 'org-1', keyVersion: 2, encryptedOrgKey: 'new-org-key' },
        projects: [expect.objectContaining({ id: 'p1', encryptedProjectKey: 'rewrapped' })],
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspace'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['projects'] });
    // The rotated project's boards now wait for the background re-key.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekey-queue'] });
    expect(progress.at(-1)).toBeNull();
  });

  it('skips the workspace key when it is not due', async () => {
    await run({ rotateWorkspace: false });

    expect(keys.rotateWorkspaceKey).not.toHaveBeenCalled();
    expect(keys.rotateDueProjects).toHaveBeenCalledOnce();
  });

  it('stops after a workspace failure, says why and clears progress', async () => {
    keys.rotateWorkspaceKey.mockRejectedValue(new KeyServiceError('locked', 'Unlock first'));

    await run();

    expect(toast.error).toHaveBeenCalledWith('Could not secure workspace. Unlock first');
    expect(keys.rotateDueProjects).not.toHaveBeenCalled();
    expect(progress.at(-1)).toBeNull();
  });

  it('reports a thrown project rotation and clears progress', async () => {
    keys.rotateDueProjects.mockRejectedValue(new Error('network down'));

    await run();

    expect(toast.error).toHaveBeenCalledWith('Could not secure every project. network down');
    expect(progress.at(-1)).toBeNull();
  });

  it('reports projects that could not be re-keyed', async () => {
    keys.rotateDueProjects.mockResolvedValue({ rotated: [], failed: 'Core' });

    await run();

    expect(toast.error).toHaveBeenCalledWith('Could not secure every project. Core');
  });

  it('clears progress when there are no projects to rotate', async () => {
    await run({ projects: [] });

    expect(keys.rotateDueProjects).not.toHaveBeenCalled();
    expect(progress.at(-1)).toBeNull();
  });
});
