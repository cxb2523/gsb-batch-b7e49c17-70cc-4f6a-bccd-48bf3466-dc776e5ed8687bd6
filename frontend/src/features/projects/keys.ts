export const projectKeys = {
  root: ['projects'] as const,
  all: (workspaceId: string) => ['projects', workspaceId] as const,
  lists: (workspaceId: string) => [...projectKeys.all(workspaceId), 'list'] as const,
  list: (workspaceId: string, params?: { page?: number; limit?: number }) =>
    [...projectKeys.lists(workspaceId), params ?? {}] as const,
  members: (workspaceId: string, projectId: string, params?: { page?: number; limit?: number }) =>
    [...projectKeys.all(workspaceId), projectId, 'members', params ?? {}] as const,
  assignable: (
    workspaceId: string,
    projectId: string,
    params?: { page?: number; limit?: number },
  ) => [...projectKeys.all(workspaceId), projectId, 'assignable', params ?? {}] as const,
};
