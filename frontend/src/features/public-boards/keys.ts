export const publicBoardKeys = {
  all: ['public-boards'] as const,
  detail: (token: string) => [...publicBoardKeys.all, token] as const,
  payload: (token: string) => [...publicBoardKeys.detail(token), 'payload'] as const,
};
