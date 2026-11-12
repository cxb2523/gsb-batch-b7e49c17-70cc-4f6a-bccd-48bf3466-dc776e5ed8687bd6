export interface BoardListParams {
  projectId?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export const boardKeys = {
  all: (workspaceId: string) => ['boards', workspaceId] as const,
  lists: (workspaceId: string) => [...boardKeys.all(workspaceId), 'list'] as const,
  list: (workspaceId: string, params?: BoardListParams) =>
    [...boardKeys.lists(workspaceId), params ?? {}] as const,
  detail: (workspaceId: string, boardId: string) =>
    [...boardKeys.all(workspaceId), 'detail', boardId] as const,
};
