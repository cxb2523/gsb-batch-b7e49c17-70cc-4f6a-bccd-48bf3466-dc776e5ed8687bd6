import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl } from '@/lib/api-url';
import { refreshAfterNotification } from '../refresh';

/**
 * Listens for "something changed" from the server and reads the inbox again. Nothing about a
 * notification travels on the stream, so there is nothing to keep in step with the lists.
 * The browser reconnects by itself; on a reconnect the inbox is read again, because events sent
 * while it was away were missed.
 */
export function useNotificationStream(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;

    const source = new EventSource(`${getApiBaseUrl()}/api/notifications/stream`, {
      withCredentials: true,
    });
    const readAgain = () => refreshAfterNotification(queryClient);

    let hasConnectedBefore = false;
    source.addEventListener('ready', () => {
      if (hasConnectedBefore) readAgain();
      hasConnectedBefore = true;
    });
    source.addEventListener('changed', readAgain);

    return () => source.close();
  }, [enabled, queryClient]);
}
