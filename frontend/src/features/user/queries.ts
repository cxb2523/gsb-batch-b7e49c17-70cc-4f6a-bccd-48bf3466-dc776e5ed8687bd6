import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { userKeys } from './keys';
import { getUserMetrics, listLinkedAccounts, listOwnedWorkspaces } from './api';

const METRICS_STALE_MS = 5 * 60 * 1000;

/** The footer's workspace and project counts; zero until the first answer. */
export function useUserMetrics() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? '';
  const { data, isLoading } = useQuery({
    queryKey: userKeys.metrics(userId),
    queryFn: getUserMetrics,
    enabled: userId !== '',
    staleTime: METRICS_STALE_MS,
  });
  return {
    workspacesCount: data?.workspacesCount ?? 0,
    projectsCount: data?.projectsCount ?? 0,
    isLoading,
  };
}

/** Call after anything that creates or deletes a workspace or project. */
export function useInvalidateUserMetrics() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [...userKeys.all, 'metrics'] });
  };
}

export function useLinkedAccounts() {
  return useQuery({
    queryKey: userKeys.linkedAccounts(),
    queryFn: listLinkedAccounts,
  });
}

export function useOwnedWorkspaces() {
  return useQuery({
    queryKey: userKeys.ownedWorkspaces(),
    queryFn: listOwnedWorkspaces,
    // Account deletion decisions must not rest on a cached list of who owns what.
    staleTime: 0,
  });
}
