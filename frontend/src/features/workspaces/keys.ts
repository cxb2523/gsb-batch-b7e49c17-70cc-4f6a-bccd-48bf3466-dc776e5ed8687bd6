export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (slugOrId: string) => [...workspaceKeys.all, 'detail', slugOrId] as const,
  homeSlug: () => [...workspaceKeys.all, 'home-slug'] as const,
  rekeyQueue: (workspaceId: string) => [...workspaceKeys.all, 'rekey-queue', workspaceId] as const,
  accessAll: ['access'] as const,
  access: (workspaceRef?: string) =>
    [...workspaceKeys.accessAll, workspaceRef ?? 'global'] as const,
};
