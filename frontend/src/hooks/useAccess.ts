import { useMemo } from 'react';
import { createMongoAbility, type MongoAbility, type RawRuleOf } from '@casl/ability';
import { unpackRules, type PackRule } from '@casl/ability/extra';
import { useAccessMe } from '@/features/workspaces/queries';

export interface UseAccessReturn {
  can: (action: string, subject: string) => boolean;
  role: string | null;
  isAdministrator: boolean;
  canCreateWorkspace: boolean;
  isLoading: boolean;
  projectRoles?: Record<string, string> | undefined;
}

type AppAbility = MongoAbility<[string, string]>;

// The server packs rules for transport; this narrows the schema's `unknown[]` without a cast.
function isPackRuleArray(val: unknown[]): val is PackRule<RawRuleOf<AppAbility>>[] {
  return Array.isArray(val);
}

function buildAbility(rawRules: unknown[] | undefined): AppAbility | null {
  if (!rawRules || rawRules.length === 0 || !isPackRuleArray(rawRules)) return null;
  return createMongoAbility<AppAbility>(unpackRules<RawRuleOf<AppAbility>>(rawRules));
}

const NO_ACCESS: UseAccessReturn = {
  can: () => false,
  role: null,
  isAdministrator: false,
  canCreateWorkspace: false,
  isLoading: false,
};
const LOADING: UseAccessReturn = { ...NO_ACCESS, isLoading: true };

/**
 * What the signed-in user may do, from the server's own rules (`GET /api/access/me`).
 * With a project id, an Admin keeps the workspace rules and everyone else gets exactly their
 * project role's rules; an Editor or Viewer with no grant on that project can do nothing there.
 */
export function useAccess(
  workspaceRef?: string | null,
  projectId?: string | null,
): UseAccessReturn {
  const { data, isLoading, isError } = useAccessMe(workspaceRef ?? undefined);

  return useMemo(() => {
    // A workspace the server will not describe (unknown, or not a member) grants nothing.
    if (isError) return NO_ACCESS;
    if (isLoading || !data) return LOADING;

    const isAdministrator = Boolean(data.isWorkspaceAdministrator);

    let rules = data.rules;
    let role = isAdministrator && projectId ? 'admin' : (data.workspaceRole ?? null);
    if (projectId && !isAdministrator) {
      const projectRole = data.projectRoles?.[projectId];
      rules = projectRole ? data.projectRules?.[projectRole] : undefined;
      role = projectRole ?? null;
    }

    const ability = buildAbility(rules);
    return {
      can: (action, subject) => ability?.can(action, subject) ?? false,
      role,
      isAdministrator,
      canCreateWorkspace: Boolean(data.canCreateWorkspace),
      isLoading: false,
      projectRoles: data.projectRoles,
    };
  }, [data, isLoading, isError, projectId]);
}
