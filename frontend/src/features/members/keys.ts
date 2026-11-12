export const memberKeys = {
  root: ['members'] as const,
  publicInvitation: (inviteId: string) => ['invitations', 'public', inviteId] as const,
  invitationRecipient: (inviteId: string, userId: string) =>
    ['invitations', 'recipient', inviteId, userId] as const,
  all: (workspaceId: string) => ['members', workspaceId] as const,
  list: (workspaceId: string, params?: { page?: number; limit?: number }) =>
    [...memberKeys.all(workspaceId), 'list', params ?? {}] as const,
  invitations: (workspaceId: string) => [...memberKeys.all(workspaceId), 'invitations'] as const,
};
