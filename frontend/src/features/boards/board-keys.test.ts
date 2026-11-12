import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWorkspace } from '@/features/workspaces/api';
import { generateSymmetricKey } from '@/lib/crypto';
import { provisionBoardKeys, resolveBoardKey, resolveProjectKey } from '@/lib/keys';
import type { BoardMetadata } from './board-metadata';
import {
  provisionCurrentBoardKey,
  resolveAccountBoardKey,
  resolveSealingBoardKey,
  type BoardKeyContext,
} from './board-keys';

vi.mock('@/features/workspaces/api', () => ({ getWorkspace: vi.fn() }));
vi.mock('@/lib/keys', () => ({
  provisionBoardKeys: vi.fn(),
  resolveBoardKey: vi.fn(),
  resolveProjectKey: vi.fn(),
}));

const workspace = (overrides: { encryptedOrgKey: string | null; keyVersion?: number }) => ({
  id: 'w1',
  name: 'Acme',
  slug: 'acme',
  ...overrides,
});

const context: BoardKeyContext = { privateKey: null, userId: 'u1', workspaceRef: 'acme' };

const board = (grantKey: string | null = 'my-grant'): BoardMetadata => ({
  id: 'b1',
  title: 'Mesh',
  projectId: 'p1',
  keyVersion: 1,
  encryptedBoardKey: 'wrapped-board',
  publicShareToken: null,
  updatedAt: '',
  project: {
    id: 'p1',
    name: 'Core',
    organizationId: 'w1',
    keyVersion: 2,
    encryptedProjectKey: 'wrapped-project',
    members: [{ id: 'm1', userId: 'u1', encryptedProjectKey: grantKey }],
  },
});

describe('board keys', () => {
  let projectKey: CryptoKey;
  let boardKey: CryptoKey;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    projectKey = await generateSymmetricKey();
    boardKey = await generateSymmetricKey();
    vi.mocked(resolveProjectKey).mockResolvedValue(projectKey);
    vi.mocked(resolveBoardKey).mockResolvedValue(boardKey);
    vi.mocked(getWorkspace).mockResolvedValue(
      workspace({ encryptedOrgKey: 'org-key', keyVersion: 3 }),
    );
  });

  describe('resolveAccountBoardKey', () => {
    it('opens the key from the caller own grant without asking for the workspace key', async () => {
      const result = await resolveAccountBoardKey(board(), context);

      expect(result).toEqual({ kind: 'key', key: boardKey });
      expect(getWorkspace).not.toHaveBeenCalled();
      expect(resolveProjectKey).toHaveBeenCalledWith(
        expect.objectContaining({
          memberEncryptedProjectKey: 'my-grant',
          projectKeyVersion: 2,
          targetVersion: 1,
          userId: 'u1',
        }),
      );
    });

    it('falls back to the workspace key when the grant carries no key and the caller holds one', async () => {
      const result = await resolveAccountBoardKey(board(null), context);

      expect(result).toEqual({ kind: 'key', key: boardKey });
      expect(resolveProjectKey).toHaveBeenCalledWith(
        expect.objectContaining({ encryptedOrgKey: 'org-key', workspaceKeyVersion: 3 }),
      );
    });

    it('is pending when the grant has no key and the caller has no workspace key either', async () => {
      vi.mocked(getWorkspace).mockResolvedValue(workspace({ encryptedOrgKey: null }));

      expect(await resolveAccountBoardKey(board(null), context)).toEqual({ kind: 'pending' });
      expect(resolveProjectKey).not.toHaveBeenCalled();
    });

    it('is unavailable when the board has no wrapped key', async () => {
      const unwrapped = { ...board(), encryptedBoardKey: null };

      expect(await resolveAccountBoardKey(unwrapped, context)).toEqual({ kind: 'unavailable' });
    });

    it('is unavailable when the key cannot be opened', async () => {
      vi.mocked(resolveProjectKey).mockRejectedValue(new Error('unwrap failed'));

      expect(await resolveAccountBoardKey(board(), context)).toEqual({ kind: 'unavailable' });
    });

    it('still tries to open the key when the workspace lookup fails', async () => {
      vi.mocked(getWorkspace).mockRejectedValue(new Error('offline'));

      const result = await resolveAccountBoardKey(board(null), context);

      expect(result).toEqual({ kind: 'key', key: boardKey });
    });
  });

  describe('resolveSealingBoardKey', () => {
    it('does not look up the workspace when the grant has a key', async () => {
      expect(await resolveSealingBoardKey(board(), context)).toBe(boardKey);
      expect(getWorkspace).not.toHaveBeenCalled();
    });

    it('looks up the workspace key when the grant has none', async () => {
      await resolveSealingBoardKey(board(null), context);

      expect(getWorkspace).toHaveBeenCalledWith('acme');
    });

    it('lets a key error reach the caller', async () => {
      vi.mocked(resolveBoardKey).mockRejectedValue(new Error('locked'));

      await expect(resolveSealingBoardKey(board(), context)).rejects.toThrow('locked');
    });
  });

  describe('provisionCurrentBoardKey', () => {
    it('wraps a fresh board key under the current project key version', async () => {
      const provision = { boardKey, encryptedBoardKey: 'wrapped-v2' };
      vi.mocked(provisionBoardKeys).mockResolvedValue(provision);

      const result = await provisionCurrentBoardKey(board(), context);

      expect(result).toBe(provision);
      expect(getWorkspace).toHaveBeenCalledWith('acme');
      expect(provisionBoardKeys).toHaveBeenCalledWith({
        projectKey,
        projectId: 'p1',
        boardId: 'b1',
        projectKeyVersion: 2,
      });
    });
  });
});
