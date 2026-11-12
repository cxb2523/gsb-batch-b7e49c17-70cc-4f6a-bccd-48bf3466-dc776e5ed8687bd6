import { z } from 'zod';
import type { Notification } from './schemas';

export interface NotificationView {
  text: string;
  /** Where the person can act on it; null when there is nothing left to open. */
  href: string | null;
}

const FALLBACK_TEXT = 'Something changed in one of your workspaces.';

const workspaceName = z.string();

const invitationAccepted = z.object({
  workspaceName,
  personName: z.string(),
  projectsWaiting: z.number(),
});
const accessGranted = z.object({ workspaceName, projectId: z.string(), projectName: z.string() });
const roleChanged = z.object({ workspaceName, role: z.string() });
const projectRoleChanged = z.object({
  workspaceName,
  projectId: z.string(),
  projectName: z.string(),
  role: z.string(),
});
const removedFromProject = z.object({ workspaceName, projectName: z.string() });
const removed = z.object({ workspaceName });

/** The project role as people name it; the workspace has its own "admin". */
const projectRoleLabel = (role: string) => (role === 'admin' ? 'project admin' : role);

/** The words and the link for one notification, built here so the server stores no sentences. */
export function describeNotification(notification: Notification): NotificationView {
  // A workspace id is accepted wherever a workspace slug is, so the link never goes stale.
  const workspaceHref = `/w/${notification.workspaceId}`;
  const fallback: NotificationView = { text: FALLBACK_TEXT, href: workspaceHref };

  switch (notification.kind) {
    case 'invitation_accepted': {
      const parsed = invitationAccepted.safeParse(notification.data);
      if (!parsed.success) return fallback;
      const { personName, workspaceName: workspace, projectsWaiting } = parsed.data;
      const waiting =
        projectsWaiting > 0
          ? ` ${projectsWaiting} ${projectsWaiting === 1 ? 'project is' : 'projects are'} waiting for you to grant access.`
          : '';
      return {
        text: `${personName} joined ${workspace}.${waiting}`,
        href: `${workspaceHref}/management`,
      };
    }
    case 'access_granted': {
      const parsed = accessGranted.safeParse(notification.data);
      if (!parsed.success) return fallback;
      const { projectName, projectId, workspaceName: workspace } = parsed.data;
      return {
        text: `You now have access to ${projectName} in ${workspace}.`,
        href: `${workspaceHref}?project=${projectId}`,
      };
    }
    case 'role_changed': {
      const parsed = roleChanged.safeParse(notification.data);
      if (!parsed.success) return fallback;
      return {
        text: `Your role in ${parsed.data.workspaceName} is now ${parsed.data.role}.`,
        href: workspaceHref,
      };
    }
    case 'project_role_changed': {
      const parsed = projectRoleChanged.safeParse(notification.data);
      if (!parsed.success) return fallback;
      const { projectName, projectId, workspaceName: workspace, role } = parsed.data;
      return {
        text: `Your role in ${projectName} (${workspace}) is now ${projectRoleLabel(role)}.`,
        href: `${workspaceHref}?project=${projectId}`,
      };
    }
    case 'removed_from_project': {
      const parsed = removedFromProject.safeParse(notification.data);
      if (!parsed.success) return fallback;
      // They are still in the workspace, so the link goes to its projects.
      return {
        text: `You were removed from ${parsed.data.projectName} in ${parsed.data.workspaceName}.`,
        href: workspaceHref,
      };
    }
    case 'removed_from_workspace': {
      const parsed = removed.safeParse(notification.data);
      if (!parsed.success) return { text: FALLBACK_TEXT, href: null };
      return { text: `You were removed from ${parsed.data.workspaceName}.`, href: null };
    }
    default:
      return fallback;
  }
}
