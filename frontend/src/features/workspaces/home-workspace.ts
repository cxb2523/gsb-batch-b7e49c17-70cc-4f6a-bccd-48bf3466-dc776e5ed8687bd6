import { authClient } from '@/lib/auth-client';

/**
 * The slug (or id) of the caller's oldest workspace, which the account pages treat as home.
 * Kept apart from `api.ts` because it needs the Better Auth client, which the re-key worker
 * (a user of `api.ts`) must not load.
 */
export async function getHomeWorkspaceSlug(): Promise<string | null> {
  const { data, error } = await authClient.organization.list();
  if (error) throw new Error(error.message ?? 'Failed to load workspaces');
  const createdAt = (workspace: { createdAt?: Date | string | null }) =>
    workspace.createdAt ? new Date(workspace.createdAt).getTime() : 0;
  const oldest = [...(data ?? [])].sort((a, b) => createdAt(a) - createdAt(b))[0];
  return oldest ? oldest.slug || oldest.id : null;
}
