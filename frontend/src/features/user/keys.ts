export const userKeys = {
  all: ['user'] as const,
  linkedAccounts: () => [...userKeys.all, 'linked-accounts'] as const,
  ownedWorkspaces: () => [...userKeys.all, 'owned-workspaces'] as const,
  metrics: (userId: string) => [...userKeys.all, 'metrics', userId] as const,
};
