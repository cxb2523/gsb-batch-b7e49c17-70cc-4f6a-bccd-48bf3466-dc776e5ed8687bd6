import { useQuery } from '@tanstack/react-query';
import { getUnreadNotificationCount, listNotifications } from './api';
import { notificationKeys } from './keys';

// The live stream says when to read again. These two options are the way back when it is down:
// coming back to the tab reads the inbox again, whatever the app-wide freshness window says.
const READ_AGAIN_ON_FOCUS = { staleTime: 0, refetchOnWindowFocus: true } as const;

export function useNotifications(page: number, enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list(page),
    queryFn: () => listNotifications(page),
    enabled,
    ...READ_AGAIN_ON_FOCUS,
  });
}

export function useUnreadNotificationCount(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: getUnreadNotificationCount,
    enabled,
    ...READ_AGAIN_ON_FOCUS,
  });
}
