import { useQueryClient } from '@tanstack/react-query';
import { memberKeys } from '@/features/members/keys';
import { projectKeys } from '@/features/projects/keys';

/** The narrowest invalidations the management sections share after a write. */
export function useWorkspaceInvalidation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateProjects = () => {
    if (workspaceId) {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceId) });
    }
  };

  /** Members and project access change together: a role or removal shifts both lists. */
  const invalidateMembers = () => {
    if (workspaceId) {
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceId) });
    }
  };

  return { invalidateProjects, invalidateMembers };
}
