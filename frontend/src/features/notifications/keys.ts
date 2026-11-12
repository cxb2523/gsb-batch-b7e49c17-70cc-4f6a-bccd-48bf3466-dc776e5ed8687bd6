export const notificationKeys = {
  all: ['notifications'] as const,
  list: (page: number) => [...notificationKeys.all, 'list', page] as const,
  unread: () => [...notificationKeys.all, 'unread'] as const,
};
