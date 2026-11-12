/**
 * Resolving the keys a canvas needs from the key hierarchy: the caller's project grant first,
 * then the workspace key used by owners and admins. The unwrapping itself lives in `lib/keys`;
 * this module only gathers its inputs from the board and the workspace.
 */

import { getWorkspace } from '@/features/workspaces/api';
import {
  provisionBoardKeys,
  resolveBoardKey,
  resolveProjectKey,
  type BoardProvision,
} from '@/lib/keys';
import type { BoardMetadata } from './board-metadata';

export interface BoardKeyContext {
  privateKey: CryptoKey | null;
  userId: string | undefined;
  /** The workspace slug or id the board is opened under. */
  workspaceRef: string;
}

export type AccountBoardKey =
  | { kind: 'key'; key: CryptoKey }
  /** The caller has a grant that nobody has wrapped a key for yet. */
  | { kind: 'pending' }
  | { kind: 'unavailable' };

interface WorkspaceKeyInfo {
  encryptedOrgKey: string | null;
  keyVersion: number | undefined;
}

/** The caller's workspace key material, or null when the lookup fails. */
async function lookupWorkspaceKey(workspaceRef: string): Promise<WorkspaceKeyInfo | null> {
  try {
    const workspace = await getWorkspace(workspaceRef);
    return {
      encryptedOrgKey: workspace.encryptedOrgKey ?? null,
      keyVersion: typeof workspace.keyVersion === 'number' ? workspace.keyVersion : undefined,
    };
  } catch {
    // The key resolution that follows fails with a typed key error when the key is needed.
    return null;
  }
}

function findOwnGrant(board: BoardMetadata, userId: string | undefined) {
  return board.project.members?.find((member) => member.userId === userId);
}

/** The grant the project key is read from: the caller's own, or the first one the board lists. */
function findGrant(board: BoardMetadata, userId: string | undefined) {
  return findOwnGrant(board, userId) ?? board.project.members?.[0];
}

function projectKeyInputs(
  board: BoardMetadata,
  context: BoardKeyContext,
  workspace: WorkspaceKeyInfo | null,
) {
  const grant = findGrant(board, context.userId);
  return {
    privateKey: context.privateKey,
    projectId: board.projectId,
    projectKeyVersion: board.project.keyVersion,
    userId: context.userId ?? grant?.userId ?? '',
    encryptedProjectKey: board.project.encryptedProjectKey,
    memberEncryptedProjectKey: grant?.encryptedProjectKey,
    encryptedOrgKey: workspace?.encryptedOrgKey ?? null,
    workspaceId: board.project.organizationId,
    workspaceKeyVersion: workspace?.keyVersion,
  };
}

async function openBoardKey(
  board: BoardMetadata,
  context: BoardKeyContext,
  workspace: WorkspaceKeyInfo | null,
): Promise<CryptoKey> {
  const projectKey = await resolveProjectKey({
    ...projectKeyInputs(board, context, workspace),
    targetVersion: board.keyVersion,
  });

  return resolveBoardKey(board.encryptedBoardKey, projectKey, {
    projectId: board.projectId,
    boardId: board.id,
    boardKeyVersion: board.keyVersion,
    projectKeyVersion: board.keyVersion,
  });
}

/** Opens a board's key for reading, telling a pending grant apart from a key that cannot be opened. */
export async function resolveAccountBoardKey(
  board: BoardMetadata,
  context: BoardKeyContext,
): Promise<AccountBoardKey> {
  if (!board.encryptedBoardKey) return { kind: 'unavailable' };

  const ownGrant = findOwnGrant(board, context.userId);
  const workspace = ownGrant?.encryptedProjectKey
    ? null
    : await lookupWorkspaceKey(context.workspaceRef);

  // A grant with no key is pending only when the caller cannot use the workspace key
  // instead: an admin whose old grant is still pending can open the project anyway.
  if (ownGrant && !ownGrant.encryptedProjectKey && workspace && !workspace.encryptedOrgKey) {
    return { kind: 'pending' };
  }

  try {
    return { kind: 'key', key: await openBoardKey(board, context, workspace) };
  } catch (err) {
    console.error('Failed to unwrap account-based board key hierarchy:', err);
    return { kind: 'unavailable' };
  }
}

/** The key to seal a save with when the board's key is still current. Throws a key error. */
export async function resolveSealingBoardKey(
  board: BoardMetadata,
  context: BoardKeyContext,
): Promise<CryptoKey> {
  const grant = findGrant(board, context.userId);
  const workspace = grant?.encryptedProjectKey
    ? null
    : await lookupWorkspaceKey(context.workspaceRef);
  return openBoardKey(board, context, workspace);
}

/**
 * A fresh board key wrapped under the project's current key, for a board whose project key
 * rotated since the board was last saved. Throws a key error.
 */
export async function provisionCurrentBoardKey(
  board: BoardMetadata,
  context: BoardKeyContext,
): Promise<BoardProvision> {
  const workspace = await lookupWorkspaceKey(context.workspaceRef);
  const projectKey = await resolveProjectKey(projectKeyInputs(board, context, workspace));

  return provisionBoardKeys({
    projectKey,
    projectId: board.projectId,
    boardId: board.id,
    projectKeyVersion: board.project.keyVersion,
  });
}
