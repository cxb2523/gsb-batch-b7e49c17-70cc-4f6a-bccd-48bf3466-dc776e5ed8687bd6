import { getProjectKeyHistory } from '@/features/projects/api';
import { getUserPublicKey } from '@/features/user/api';
import { generateSymmetricKey, importPublicKey } from '@/lib/crypto';
import {
  unwrapBoardKeyFromProject,
  unwrapProjectKeyForMember,
  unwrapProjectKeyFromWorkspace,
  unwrapProjectKeyHistory,
  unwrapWorkspaceKeyForMember,
  wrapBoardKeyForProject,
  wrapProjectKeyForMember as wrapMemberProjectKey,
  wrapProjectKeyForWorkspace,
  wrapWorkspaceKeyForMember as wrapMemberWorkspaceKey,
} from '@/lib/crypto-format';
import { KeyServiceError } from './errors.js';

/**
 * The only place in the frontend that does key work.
 *
 * Each function either returns the key (or the wrapped-key payload) it promised, or throws a
 * `KeyServiceError` with a stable code. Nothing returns `undefined` and nothing swallows a
 * failure: a caller that cannot wrap a key must create nothing.
 *
 * Every blob is made or opened through `lib/crypto-format`, with the ids and versions of the
 * resource it belongs to. Those versions are the server's current generation values.
 */

export const INITIAL_KEY_VERSION = 1;

export interface WorkspaceProjectInput {
  id: string;
  name: string;
  encryptedProjectKey: string;
  creatorEncryptedProjectKey: string;
  keyVersion: number;
}

export interface WorkspaceProvision {
  encryptedOrgKey: string;
  project: WorkspaceProjectInput;
}

export interface ProjectProvision {
  id: string;
  name: string;
  encryptedProjectKey: string;
  creatorEncryptedProjectKey: string;
  keyVersion: number;
}

export interface BoardProvision {
  boardKey: CryptoKey;
  encryptedBoardKey: string;
}

async function publicKeyFrom(spki: string | null): Promise<CryptoKey> {
  if (!spki) {
    throw new KeyServiceError(
      'no-public-key',
      'Your encryption passphrase is not set up, so no key can be wrapped.',
    );
  }

  try {
    return await importPublicKey(spki);
  } catch (error) {
    throw new KeyServiceError('wrap-failed', 'Could not read your public key.', { cause: error });
  }
}

async function asKeyServiceError<T>(promise: Promise<T>, message: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof KeyServiceError) throw error;
    throw new KeyServiceError('unwrap-failed', message, { cause: error });
  }
}

/** Provisions the workspace key and the first project's keys for a new workspace. */
export async function provisionWorkspaceKeys(params: {
  workspaceId: string;
  projectId: string;
  userId: string;
  publicKeySpki: string | null;
  projectName: string;
}): Promise<WorkspaceProvision> {
  const { workspaceId, projectId, userId, publicKeySpki, projectName } = params;
  const publicKey = await publicKeyFrom(publicKeySpki);

  let orgKey: CryptoKey;
  try {
    orgKey = await generateSymmetricKey();
  } catch (error) {
    throw new KeyServiceError('wrap-failed', 'Could not generate the workspace key.', {
      cause: error,
    });
  }

  const encryptedOrgKey = await wrapMemberWorkspaceKey(orgKey, publicKey, {
    workspaceId,
    userId,
    workspaceKeyVersion: INITIAL_KEY_VERSION,
  });

  const project = await provisionProjectKeys({
    orgKey,
    projectId,
    workspaceId,
    workspaceKeyVersion: INITIAL_KEY_VERSION,
    userId,
    publicKeySpki,
    projectName,
  });

  return { encryptedOrgKey, project };
}

/** Provisions a project's workspace-wrapped key and the creator's own wrapped grant. */
export async function provisionProjectKeys(params: {
  orgKey: CryptoKey | null;
  workspaceKeyVersion: number;
  workspaceId: string;
  projectId: string;
  userId: string;
  publicKeySpki: string | null;
  projectName: string;
}): Promise<ProjectProvision> {
  const { orgKey, workspaceKeyVersion, workspaceId, projectId, userId, publicKeySpki } = params;
  if (!orgKey) {
    throw new KeyServiceError(
      'no-workspace-key',
      'The workspace key is locked, so a project cannot be created.',
    );
  }

  const publicKey = await publicKeyFrom(publicKeySpki);

  let projectKey: CryptoKey;
  try {
    projectKey = await generateSymmetricKey();
  } catch (error) {
    throw new KeyServiceError('wrap-failed', 'Could not generate the project key.', {
      cause: error,
    });
  }

  return {
    id: projectId,
    name: params.projectName,
    keyVersion: INITIAL_KEY_VERSION,
    encryptedProjectKey: await wrapProjectKeyForWorkspace(projectKey, orgKey, {
      workspaceId,
      projectId,
      projectKeyVersion: INITIAL_KEY_VERSION,
      workspaceKeyVersion,
    }),
    creatorEncryptedProjectKey: await wrapMemberProjectKey(projectKey, publicKey, {
      projectId,
      userId,
      projectKeyVersion: INITIAL_KEY_VERSION,
    }),
  };
}

/**
 * Generates a board key and wraps it with the project key. The board's key generation is the
 * project's: the server stores the project's version on the board, and the browser opens the board
 * with that number, so a canvas made after a rotation must be sealed as that version.
 */
export async function provisionBoardKeys(params: {
  projectKey: CryptoKey | null;
  projectId: string;
  boardId: string;
  projectKeyVersion: number;
}): Promise<BoardProvision> {
  const { projectKey, projectId, boardId, projectKeyVersion } = params;
  const boardKeyVersion = projectKeyVersion;
  if (!projectKey) {
    throw new KeyServiceError(
      'no-project-key',
      'The project key is unavailable, so the canvas cannot be encrypted.',
    );
  }

  let boardKey: CryptoKey;
  try {
    boardKey = await generateSymmetricKey();
  } catch (error) {
    throw new KeyServiceError('wrap-failed', 'Could not generate the canvas key.', {
      cause: error,
    });
  }

  return {
    boardKey,
    encryptedBoardKey: await wrapBoardKeyForProject(boardKey, projectKey, {
      projectId,
      boardId,
      boardKeyVersion,
      projectKeyVersion,
    }),
  };
}

/** Unwraps the caller's workspace key from their membership. */
export async function resolveOrgKey(
  encryptedOrgKey: string | null | undefined,
  privateKey: CryptoKey | null,
  context: { workspaceId: string; userId: string; workspaceKeyVersion: number },
): Promise<CryptoKey> {
  if (!privateKey) {
    throw new KeyServiceError('locked', 'Unlock your encryption passphrase to continue.');
  }
  if (!encryptedOrgKey) {
    throw new KeyServiceError(
      'no-workspace-key',
      'This account has no workspace key, so key operations are unavailable.',
    );
  }

  return asKeyServiceError(
    unwrapWorkspaceKeyForMember(encryptedOrgKey, privateKey, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      workspaceKeyVersion: context.workspaceKeyVersion,
    }),
    'Could not open the workspace key.',
  );
}

/**
 * Resolves a project key for the caller: their own grant first, then the workspace key path
 * used by owners and admins.
 */
export async function resolveProjectKey(params: {
  privateKey: CryptoKey | null;
  projectId: string;
  projectKeyVersion: number;
  /** The version needed; when older than the current one, walk the server's history chain. */
  targetVersion?: number | undefined;
  userId: string;
  encryptedProjectKey?: string | null | undefined;
  memberEncryptedProjectKey?: string | null | undefined;
  encryptedOrgKey?: string | null | undefined;
  workspaceId?: string | undefined;
  workspaceKeyVersion?: number | undefined;
}): Promise<CryptoKey> {
  const {
    privateKey,
    projectId,
    projectKeyVersion,
    userId,
    encryptedProjectKey,
    memberEncryptedProjectKey,
    encryptedOrgKey,
    workspaceId,
    workspaceKeyVersion,
  } = params;

  if (!privateKey) {
    throw new KeyServiceError('locked', 'Unlock your encryption passphrase to continue.');
  }
  if (!encryptedProjectKey) {
    throw new KeyServiceError(
      'no-project-key',
      'This project has no wrapped key, so it cannot be opened.',
    );
  }

  let currentKey: CryptoKey;
  if (memberEncryptedProjectKey) {
    currentKey = await asKeyServiceError(
      unwrapProjectKeyForMember(memberEncryptedProjectKey, privateKey, {
        projectId,
        userId,
        projectKeyVersion,
      }),
      'Could not open your project key.',
    );
  } else if (encryptedOrgKey && workspaceId !== undefined && workspaceKeyVersion !== undefined) {
    const orgKey = await resolveOrgKey(encryptedOrgKey, privateKey, {
      workspaceId,
      userId,
      workspaceKeyVersion,
    });
    currentKey = await asKeyServiceError(
      unwrapProjectKeyFromWorkspace(encryptedProjectKey, orgKey, {
        workspaceId,
        projectId,
        projectKeyVersion,
        workspaceKeyVersion,
      }),
      'Could not open the project key.',
    );
  } else {
    throw new KeyServiceError(
      'no-project-key',
      'You do not have a key for this project. Ask a workspace administrator for access.',
    );
  }

  const targetVersion = params.targetVersion ?? projectKeyVersion;
  if (targetVersion === projectKeyVersion) {
    return currentKey;
  }
  if (targetVersion > projectKeyVersion || targetVersion < 1) {
    throw new KeyServiceError(
      'no-project-key',
      'This board asks for a project key generation that does not exist.',
    );
  }
  if (workspaceId === undefined) {
    throw new KeyServiceError(
      'no-project-key',
      'The project key history is unavailable for this account.',
    );
  }

  const history = await fetchProjectKeyHistory(projectId, workspaceId);
  const walkStep = async (key: CryptoKey, version: number): Promise<CryptoKey> => {
    if (version <= targetVersion) return key;
    const entry = history.entries.find((candidate) => candidate.newVersion === version);
    if (!entry) {
      throw new KeyServiceError(
        'no-project-key',
        `The history chain does not reach project key version ${targetVersion}.`,
      );
    }
    const unwrapped = await asKeyServiceError(
      unwrapProjectKeyHistory(entry.encryptedKey, key, {
        projectId,
        oldVersion: entry.oldVersion,
        newVersion: entry.newVersion,
      }),
      'Could not walk the project key history.',
    );
    return walkStep(unwrapped, entry.oldVersion);
  };

  return walkStep(currentKey, projectKeyVersion);
}

interface ProjectKeyHistoryEntry {
  oldVersion: number;
  newVersion: number;
  encryptedKey: string;
}

/** The server's history chain; no client cache, because it changes with every rotation. */
async function fetchProjectKeyHistory(
  projectId: string,
  workspaceId: string,
): Promise<{ keyVersion: number; entries: ProjectKeyHistoryEntry[] }> {
  try {
    const data = await getProjectKeyHistory(workspaceId, projectId);
    return {
      keyVersion: data.keyVersion,
      entries: data.entries,
    };
  } catch (err) {
    if (err instanceof KeyServiceError) throw err;
    throw new KeyServiceError('no-project-key', 'The project key history could not be fetched.');
  }
}

/** Unwraps a board key with its project key. */
export async function resolveBoardKey(
  encryptedBoardKey: string | null | undefined,
  projectKey: CryptoKey | null,
  context: {
    projectId: string;
    boardId: string;
    boardKeyVersion: number;
    projectKeyVersion: number;
  },
): Promise<CryptoKey> {
  if (!encryptedBoardKey) {
    throw new KeyServiceError(
      'no-project-key',
      'This canvas has no wrapped key, so it cannot be opened.',
    );
  }
  if (!projectKey) {
    throw new KeyServiceError(
      'no-project-key',
      'The project key is unavailable, so the canvas cannot be opened.',
    );
  }

  return asKeyServiceError(
    unwrapBoardKeyFromProject(encryptedBoardKey, projectKey, context),
    'Could not open the canvas key.',
  );
}

/** Wraps a project key for another member's public key. */
export async function wrapKeyForMember(
  projectKey: CryptoKey,
  publicKeySpki: string | null,
  context: { projectId: string; userId: string; projectKeyVersion: number },
): Promise<string> {
  const publicKey = await publicKeyFrom(publicKeySpki);
  return wrapMemberProjectKey(projectKey, publicKey, context);
}

/** Wraps a workspace key for a member who is being promoted to admin. */
export async function wrapWorkspaceKeyForMember(
  workspaceKey: CryptoKey,
  publicKeySpki: string | null,
  context: { workspaceId: string; userId: string; workspaceKeyVersion: number },
): Promise<string> {
  const publicKey = await publicKeyFrom(publicKeySpki);
  return wrapMemberWorkspaceKey(workspaceKey, publicKey, context);
}

/** Reads a colleague's public key. The server only returns it for a shared workspace. */
export async function fetchColleaguePublicKey(userId: string): Promise<string> {
  try {
    const data = await getUserPublicKey(userId);
    return data.publicKey;
  } catch (err) {
    if (err instanceof KeyServiceError) throw err;
    throw new KeyServiceError(
      'no-public-key',
      'That person has not set up encryption, or you do not share a workspace with them.',
    );
  }
}

export { KeyServiceError } from './errors.js';
export type { KeyServiceErrorCode } from './errors.js';
