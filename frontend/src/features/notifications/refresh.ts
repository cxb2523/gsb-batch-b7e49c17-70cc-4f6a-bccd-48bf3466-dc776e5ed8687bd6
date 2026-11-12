import type { QueryClient } from '@tanstack/react-query';
import { memberKeys } from '@/features/members/keys';
import { projectKeys } from '@/features/projects/keys';
import { workspaceKeys } from '@/features/workspaces/keys';
import { notificationKeys } from './keys';

/**
 * A notification means somebody changed what this person can see or do, so the inbox is not the
 * only thing out of date: the rights, the workspaces, the projects and the members are read again
 * too. Without this, opening "You now have access to Roadmap" lands on a project list that has
 * not heard of Roadmap yet.
 */
export function refreshAfterNotification(queryClient: QueryClient): void {
  const stale = [
    notificationKeys.all,
    workspaceKeys.all,
    workspaceKeys.accessAll,
    projectKeys.root,
    memberKeys.root,
  ];
  for (const queryKey of stale) void queryClient.invalidateQueries({ queryKey });
}
