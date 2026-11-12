import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { workspaceKeys } from '@/features/workspaces/keys';
import { projectKeys } from '@/features/projects/keys';
import type { Workspace } from '@/features/workspaces/schemas';
import type { Project } from '@/features/projects/schemas';
import { rotateWorkspaceThenProjects, toRotationProjects } from '../rotation';

/**
 * Re-keys the workspace and the given projects after an administrator loses access. The workspace
 * key rotates first because project keys are wrapped under it.
 */
export function useKeyRotation(params: {
  workspace: Workspace | null;
  projects: Project[];
  isAdministrator: boolean;
}) {
  const { workspace, projects, isAdministrator } = params;
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { privateKey } = useKeyContext();
  const [rotationProgress, setRotationProgress] = useState<string | null>(null);

  const runRotation = async (projectIds: string[], rotateWorkspaceFirst = false) => {
    const orgId = workspace?.id;
    const userId = session?.user?.id;
    if (!orgId || !userId || typeof workspace?.keyVersion !== 'number' || !isAdministrator) return;

    await rotateWorkspaceThenProjects({
      workspace: {
        id: orgId,
        keyVersion: workspace.keyVersion,
        encryptedOrgKey: workspace.encryptedOrgKey ?? null,
      },
      rotateWorkspace: rotateWorkspaceFirst || workspace.keyRotationDue === true,
      projects: toRotationProjects(projects, (project) => projectIds.includes(project.id)),
      privateKey,
      userId,
      queryClient,
      invalidate: {
        workspace: workspaceKeys.all,
        projects: projectKeys.all(orgId),
        rekeyQueue: workspaceKeys.rekeyQueue(orgId),
      },
      onProgress: setRotationProgress,
    });
  };

  return { rotationProgress, runRotation };
}
