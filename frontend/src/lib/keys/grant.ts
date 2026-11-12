import { fetchColleaguePublicKey, resolveProjectKey, wrapKeyForMember } from './service.js';

export interface GrantProject {
  id: string;
  keyVersion?: number | undefined;
  encryptedProjectKey?: string | null | undefined;
  members?:
    | ReadonlyArray<{
        userId?: string | undefined;
        encryptedProjectKey?: string | null | undefined;
      }>
    | undefined;
}

export interface GrantWorkspace {
  id: string;
  keyVersion?: number | undefined;
  encryptedOrgKey?: string | null | undefined;
}

export interface ProjectGrant {
  encryptedProjectKey: string;
}

/**
 * Prepares everything a project grant needs before anything is written: the actor's project key,
 * the target's public key, and the project key wrapped for them. Any failure throws and nothing
 * has been created.
 */
export async function prepareProjectGrant(params: {
  privateKey: CryptoKey | null;
  actorId: string;
  project: GrantProject;
  workspace: GrantWorkspace;
  targetUserId: string;
}): Promise<ProjectGrant> {
  const { privateKey, actorId, project, workspace, targetUserId } = params;
  const projectKeyVersion = project.keyVersion;
  if (projectKeyVersion === undefined) {
    throw new Error('The project key version is unavailable. Reload and try again.');
  }

  const actorGrant = project.members?.find((member) => member.userId === actorId);
  const projectKey = await resolveProjectKey({
    privateKey,
    projectId: project.id,
    projectKeyVersion,
    userId: actorId,
    encryptedProjectKey: project.encryptedProjectKey,
    memberEncryptedProjectKey: actorGrant?.encryptedProjectKey,
    encryptedOrgKey: workspace.encryptedOrgKey,
    workspaceId: workspace.id,
    workspaceKeyVersion: workspace.keyVersion,
  });
  const targetPublicKey = await fetchColleaguePublicKey(targetUserId);
  const encryptedProjectKey = await wrapKeyForMember(projectKey, targetPublicKey, {
    projectId: project.id,
    userId: targetUserId,
    projectKeyVersion,
  });

  return { encryptedProjectKey };
}
