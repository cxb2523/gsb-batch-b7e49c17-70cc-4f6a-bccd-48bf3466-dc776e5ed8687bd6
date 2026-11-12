import { useQuery } from '@tanstack/react-query';
import { authClient } from '@/lib/auth-client';
import { workspaceKeys } from './keys';
import { getWorkspace, getAccessMe, getRekeyQueue } from './api';
import { getHomeWorkspaceSlug } from './home-workspace';

export function useWorkspace(slugOrId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.detail(slugOrId ?? ''),
    queryFn: () => getWorkspace(slugOrId ?? ''),
    enabled: Boolean(slugOrId),
  });
}

export function useHomeWorkspaceSlug() {
  return useQuery({
    queryKey: workspaceKeys.homeSlug(),
    queryFn: getHomeWorkspaceSlug,
  });
}

/** The workspaces the signed-in user belongs to, as Better Auth lists them (for the switcher). */
export function useUserOrganizations() {
  return useQuery({
    queryKey: [...workspaceKeys.all, 'organizations'] as const,
    queryFn: async () => {
      const { data, error } = await authClient.organization.list();
      if (error) throw new Error(error.message ?? 'Could not load your workspaces.');
      return data ?? [];
    },
  });
}

/** The boards the workspace still has to move to their project's current key (administrators only). */
export function useRekeyQueue(workspaceId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: workspaceKeys.rekeyQueue(workspaceId ?? ''),
    queryFn: () => getRekeyQueue(workspaceId ?? ''),
    enabled: enabled && Boolean(workspaceId),
  });
}

export function useAccessMe(workspaceRef?: string) {
  return useQuery({
    queryKey: workspaceKeys.access(workspaceRef),
    queryFn: () => getAccessMe(workspaceRef),
  });
}
