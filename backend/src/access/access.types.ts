import type { AppAbility } from './abilities.js';
import type { ProjectRole, WorkspaceRole } from './roles.js';

/** The authenticated user, as Better Auth returns it (only the fields the API uses). */
export interface AccessUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/**
 * Everything one request needs to make an authorization decision, resolved exactly once by
 * `AccessGuard` and handed to the handler. Services never look up a membership themselves.
 */
export interface Access {
  user: AccessUser;
  /** Null for session-scoped routes (`/api/user/*`, invitation acceptance). */
  workspace: { id: string; slug: string | null } | null;
  workspaceRole: WorkspaceRole | null;
  /** The caller's `Member` row id, when a workspace was resolved. */
  memberId: string | null;
  /** Null unless the route resolved a project (or a board inside one). */
  project: { id: string } | null;
  projectRole: ProjectRole | null;
  /** Set only by board-scoped routes. */
  boardId: string | null;
  ability: AppAbility;
}
