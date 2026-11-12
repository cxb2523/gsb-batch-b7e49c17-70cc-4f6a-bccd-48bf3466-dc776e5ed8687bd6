import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { workspaceKeys } from '@/features/workspaces/keys';
import type { Workspace } from '@/features/workspaces/schemas';
import { rotateWorkspaceThenProjects, toRotationProjects } from '@/features/workspaces/rotation';
import { projectKeys } from '../keys';
import type { Project } from '../schemas';

/**
 * Rotates the workspace key and any project whose access changed, without waiting for a user
 * decision. The workspace key rotates first, then due projects rotate under it. Runs once per
 * workspace and only for administrators. Returns a progress label while it works.
 */
export function useDueKeyRotation({
  workspace,
  workspaceSlug,
  projects,
  isAdministrator,
}: {
  workspace: Workspace | undefined;
  workspaceSlug: string;
  projects: Project[];
  isAdministrator: boolean;
}): string | null {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { privateKey } = useKeyContext();
  const [progress, setProgress] = useState<string | null>(null);
  const startedForWorkspace = useRef<string | null>(null);

  const workspaceId = workspace?.id;
  const keyVersion = workspace?.keyVersion;
  const encryptedOrgKey = workspace?.encryptedOrgKey ?? null;
  const workspaceRotationDue = workspace?.keyRotationDue ?? false;
  const userId = session?.user?.id;

  useEffect(() => {
    if (!workspaceId || !userId || !isAdministrator) return;
    const dueProjects = toRotationProjects(projects, (project) => project.keyRotationDue === true);
    const hasDueProjects = projects.some((project) => project.keyRotationDue);
    if (typeof keyVersion !== 'number' || (!workspaceRotationDue && !hasDueProjects)) return;
    if (startedForWorkspace.current === workspaceId) return;
    startedForWorkspace.current = workspaceId;

    void rotateWorkspaceThenProjects({
      workspace: { id: workspaceId, keyVersion, encryptedOrgKey },
      rotateWorkspace: workspaceRotationDue,
      projects: dueProjects,
      privateKey,
      userId,
      queryClient,
      invalidate: {
        workspace: workspaceKeys.detail(workspaceSlug),
        projects: projectKeys.lists(workspaceId),
        rekeyQueue: workspaceKeys.rekeyQueue(workspaceId),
      },
      onProgress: setProgress,
    });
  }, [
    workspaceId,
    isAdministrator,
    projects,
    keyVersion,
    workspaceRotationDue,
    encryptedOrgKey,
    privateKey,
    userId,
    workspaceSlug,
    queryClient,
  ]);

  return progress;
}
