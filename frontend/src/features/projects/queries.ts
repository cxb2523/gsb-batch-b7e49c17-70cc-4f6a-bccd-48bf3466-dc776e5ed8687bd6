import { useQuery } from '@tanstack/react-query';
import { projectKeys } from './keys';
import { listProjects, listProjectMembers, listAssignableMembers } from './api';

export function useProjects(
  workspaceId: string | undefined,
  params?: { page?: number; limit?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId ?? '', params),
    queryFn: () => listProjects(workspaceId ?? '', params),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useProjectMembers(
  workspaceId: string | undefined,
  projectId: string | undefined,
  params?: { page?: number; limit?: number },
) {
  return useQuery({
    queryKey: projectKeys.members(workspaceId ?? '', projectId ?? '', params),
    queryFn: () => listProjectMembers(workspaceId ?? '', projectId ?? '', params),
    enabled: Boolean(workspaceId && projectId),
  });
}

/** The people who could still be given this project, for whoever may manage its members. */
export function useAssignableMembers(
  workspaceId: string | undefined,
  projectId: string | undefined,
  params?: { page?: number; limit?: number },
) {
  return useQuery({
    queryKey: projectKeys.assignable(workspaceId ?? '', projectId ?? '', params),
    queryFn: () => listAssignableMembers(workspaceId ?? '', projectId ?? '', params),
    enabled: Boolean(workspaceId && projectId),
  });
}
