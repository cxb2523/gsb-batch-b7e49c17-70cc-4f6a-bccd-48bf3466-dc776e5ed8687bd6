import {
  getProjectRotationPlan,
  rotateProjectKey as apiRotateProjectKey,
} from '@/features/projects/api';
import {
  getWorkspaceRotationPlan,
  rotateWorkspaceKey as apiRotateWorkspaceKey,
} from '@/features/workspaces/api';
import { ApiError } from '@/lib/http';
import { generateSymmetricKey } from '@/lib/crypto';
import {
  unwrapProjectKeyFromWorkspace,
  wrapProjectKeyForWorkspace,
  wrapProjectKeyHistory,
} from '@/lib/crypto-format';
import { KeyServiceError } from './errors.js';
import { resolveOrgKey, wrapKeyForMember, wrapWorkspaceKeyForMember } from './service.js';

export interface RotationProject {
  id: string;
  keyVersion: number;
  keyRotationDue?: boolean;
  encryptedProjectKey?: string | null;
}

export interface RotationWorkspace {
  id: string;
  keyVersion: number;
  keyRotationDue?: boolean;
  encryptedOrgKey?: string | null;
}

export interface RotationPlanGrant {
  userId: string;
  publicKey: string | null;
}

export interface WorkspaceRotationPlanHolder {
  userId: string;
  publicKey: string | null;
}

export interface WorkspaceRotationPlanProject {
  id: string;
  keyVersion: number;
  encryptedProjectKey: string;
}

async function fetchRotationPlan(
  projectId: string,
  workspaceId: string,
): Promise<{ keyVersion: number; grants: RotationPlanGrant[] }> {
  try {
    const data = await getProjectRotationPlan(workspaceId, projectId);
    return {
      keyVersion: data.keyVersion,
      grants: data.grants,
    };
  } catch (err) {
    if (err instanceof KeyServiceError) throw err;
    throw new KeyServiceError('no-project-key', 'The rotation plan could not be fetched.');
  }
}

/**
 * Rotates one project key: generate v+1, wrap it for the workspace and every currently granted
 * person, wrap the old key under the new one, and post all of it in one request. Throws a typed
 * error and changes nothing when any step fails; a stale version means another admin won.
 */
export async function rotateProjectKey(params: {
  project: RotationProject;
  workspace: RotationWorkspace;
  privateKey: CryptoKey | null;
  userId: string;
}): Promise<{ keyVersion: number }> {
  const { project, workspace, privateKey, userId } = params;

  if (!privateKey) {
    throw new KeyServiceError('locked', 'Unlock your encryption passphrase to rotate a key.');
  }
  if (!project.encryptedProjectKey) {
    throw new KeyServiceError('no-project-key', 'The project has no wrapped key to rotate.');
  }

  const plan = await fetchRotationPlan(project.id, workspace.id);
  const currentVersion = plan.keyVersion;
  if (currentVersion !== project.keyVersion) {
    throw new KeyServiceError('rotation-stale', 'Another administrator already rotated this key.');
  }
  if (plan.grants.some((grant) => !grant.publicKey)) {
    throw new KeyServiceError(
      'no-public-key',
      'A granted person has no public key, so their copy cannot be wrapped. Rotation stopped.',
    );
  }

  const newVersion = currentVersion + 1;
  const orgKey = await resolveOrgKey(workspace.encryptedOrgKey, privateKey, {
    workspaceId: workspace.id,
    userId,
    workspaceKeyVersion: workspace.keyVersion,
  });
  const oldProjectKey = await unwrapProjectKeyFromWorkspace(project.encryptedProjectKey, orgKey, {
    workspaceId: workspace.id,
    projectId: project.id,
    projectKeyVersion: currentVersion,
    workspaceKeyVersion: workspace.keyVersion,
  });

  let newProjectKey: CryptoKey;
  try {
    newProjectKey = await generateSymmetricKey();
  } catch (error) {
    throw new KeyServiceError('wrap-failed', 'Could not generate the new project key.', {
      cause: error,
    });
  }

  const encryptedProjectKey = await wrapProjectKeyForWorkspace(newProjectKey, orgKey, {
    workspaceId: workspace.id,
    projectId: project.id,
    projectKeyVersion: newVersion,
    workspaceKeyVersion: workspace.keyVersion,
  });
  const historyEntry = await wrapProjectKeyHistory(oldProjectKey, newProjectKey, {
    projectId: project.id,
    oldVersion: currentVersion,
    newVersion,
  });

  const grants = await Promise.all(
    plan.grants.map(async (grant) => ({
      userId: grant.userId,
      encryptedProjectKey: await wrapKeyForMember(newProjectKey, grant.publicKey, {
        projectId: project.id,
        userId: grant.userId,
        projectKeyVersion: newVersion,
      }),
    })),
  );

  try {
    const result = await apiRotateProjectKey(workspace.id, project.id, {
      expectedVersion: currentVersion,
      encryptedProjectKey,
      historyEntry,
      grants,
    });
    if (result.keyVersion !== newVersion) {
      throw new KeyServiceError('wrap-failed', 'The server did not confirm the new key version.');
    }
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'STALE_KEY_VERSION' || err.status === 409) {
        throw new KeyServiceError(
          'rotation-stale',
          'Another administrator already rotated this key.',
        );
      }
      throw new KeyServiceError('wrap-failed', err.message || 'The server refused the rotation.');
    }
    if (err instanceof KeyServiceError) throw err;
    throw new KeyServiceError('wrap-failed', 'The server refused the rotation.');
  }

  return { keyVersion: newVersion };
}

/**
 * Rotates the due projects one after another. A stale project is already done; any other failure
 * stops the run and leaves the remaining flags for the next administrator.
 */
export async function rotateDueProjects(params: {
  projects: RotationProject[];
  workspace: RotationWorkspace;
  privateKey: CryptoKey | null;
  userId: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ rotated: string[]; failed: string | null }> {
  const due = params.projects.filter((project) => project.keyRotationDue);
  const rotated: string[] = [];

  const runIndex = async (index: number): Promise<{ rotated: string[]; failed: string | null }> => {
    if (index >= due.length) {
      params.onProgress?.(due.length, due.length);
      return { rotated, failed: null };
    }
    const project = due[index];
    if (!project) {
      return runIndex(index + 1);
    }
    params.onProgress?.(index, due.length);
    try {
      await rotateProjectKey({
        project,
        workspace: params.workspace,
        privateKey: params.privateKey,
        userId: params.userId,
      });
      rotated.push(project.id);
      return runIndex(index + 1);
    } catch (error) {
      if (error instanceof KeyServiceError && error.code === 'rotation-stale') {
        rotated.push(project.id);
        return runIndex(index + 1);
      }
      return {
        rotated,
        failed:
          error instanceof KeyServiceError
            ? error.message
            : 'The project key could not be rotated.',
      };
    }
  };

  return runIndex(0);
}

async function fetchWorkspaceRotationPlan(workspaceId: string): Promise<{
  keyVersion: number;
  holders: WorkspaceRotationPlanHolder[];
  projects: WorkspaceRotationPlanProject[];
}> {
  try {
    const data = await getWorkspaceRotationPlan(workspaceId);
    return {
      keyVersion: data.keyVersion,
      holders: data.holders,
      projects: data.projects,
    };
  } catch (err) {
    if (err instanceof KeyServiceError) throw err;
    throw new KeyServiceError(
      'no-workspace-key',
      'The workspace rotation plan could not be fetched.',
    );
  }
}

/**
 * Rotates the workspace key: generate v+1, rewrap it for every administrator, rewrap every project
 * key under the new workspace key, and post all of it in one transaction. Throws a typed error and
 * changes nothing when any step fails; a stale version means another admin won.
 */
export interface RotateWorkspaceKeyResult {
  keyVersion: number;
  newEncryptedOrgKey?: string | undefined;
  rewrappedProjects?: Array<{ id: string; encryptedProjectKey: string }> | undefined;
}

export async function rotateWorkspaceKey(params: {
  workspace: RotationWorkspace;
  privateKey: CryptoKey | null;
  userId: string;
}): Promise<RotateWorkspaceKeyResult> {
  const { workspace, privateKey, userId } = params;

  if (!privateKey) {
    throw new KeyServiceError('locked', 'Unlock your encryption passphrase to rotate a key.');
  }
  if (!workspace.encryptedOrgKey) {
    throw new KeyServiceError('no-workspace-key', 'The workspace has no wrapped key to rotate.');
  }

  const plan = await fetchWorkspaceRotationPlan(workspace.id);
  const currentVersion = plan.keyVersion;
  if (currentVersion !== workspace.keyVersion) {
    throw new KeyServiceError(
      'rotation-stale',
      'Another administrator already rotated this workspace key.',
    );
  }

  if (plan.holders.some((holder) => !holder.publicKey)) {
    throw new KeyServiceError(
      'no-public-key',
      'A workspace administrator has no public key, so their copy cannot be wrapped. Rotation stopped.',
    );
  }

  const newVersion = currentVersion + 1;
  const oldOrgKey = await resolveOrgKey(workspace.encryptedOrgKey, privateKey, {
    workspaceId: workspace.id,
    userId,
    workspaceKeyVersion: currentVersion,
  });

  const projectKeys = await Promise.all(
    plan.projects.map(async (project) => {
      const projectKey = await unwrapProjectKeyFromWorkspace(
        project.encryptedProjectKey,
        oldOrgKey,
        {
          workspaceId: workspace.id,
          projectId: project.id,
          projectKeyVersion: project.keyVersion,
          workspaceKeyVersion: currentVersion,
        },
      );
      return { project, projectKey };
    }),
  );

  let newOrgKey: CryptoKey;
  try {
    newOrgKey = await generateSymmetricKey();
  } catch (error) {
    throw new KeyServiceError('wrap-failed', 'Could not generate the new workspace key.', {
      cause: error,
    });
  }

  const encryptedOrgKeys = await Promise.all(
    plan.holders.map(async (holder) => ({
      userId: holder.userId,
      encryptedOrgKey: await wrapWorkspaceKeyForMember(newOrgKey, holder.publicKey, {
        workspaceId: workspace.id,
        userId: holder.userId,
        workspaceKeyVersion: newVersion,
      }),
    })),
  );

  const projects = await Promise.all(
    projectKeys.map(async ({ project, projectKey }) => ({
      id: project.id,
      projectKeyVersion: project.keyVersion,
      encryptedProjectKey: await wrapProjectKeyForWorkspace(projectKey, newOrgKey, {
        workspaceId: workspace.id,
        projectId: project.id,
        projectKeyVersion: project.keyVersion,
        workspaceKeyVersion: newVersion,
      }),
    })),
  );

  try {
    const result = await apiRotateWorkspaceKey(workspace.id, {
      expectedVersion: currentVersion,
      encryptedOrgKeys,
      projects,
    });
    if (result.keyVersion !== newVersion) {
      throw new KeyServiceError(
        'wrap-failed',
        'The server did not confirm the new workspace key version.',
      );
    }
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'STALE_KEY_VERSION' || err.status === 409) {
        throw new KeyServiceError(
          'rotation-stale',
          'Another administrator already rotated this workspace key.',
        );
      }
      throw new KeyServiceError(
        'wrap-failed',
        err.message || 'The server refused the workspace rotation.',
      );
    }
    if (err instanceof KeyServiceError) throw err;
    throw new KeyServiceError('wrap-failed', 'The server refused the workspace rotation.');
  }

  const myWrap = encryptedOrgKeys.find((k) => k.userId === userId);
  return {
    keyVersion: newVersion,
    newEncryptedOrgKey: myWrap?.encryptedOrgKey,
    rewrappedProjects: projects.map((p) => ({
      id: p.id,
      encryptedProjectKey: p.encryptedProjectKey,
    })),
  };
}
