/** The closed list of notifications. The database CHECK constraint on `notification.kind` mirrors it. */
export const NOTIFICATION_KINDS = [
  'invitation_accepted',
  'access_granted',
  'role_changed',
  'project_role_changed',
  'removed_from_project',
  'removed_from_workspace',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
