import { useSession } from '@/lib/auth-client';
import { useNotificationStream } from '../hooks/useNotificationStream';

/** Keeps one live connection open for as long as somebody is signed in, whichever page they are on. */
export function NotificationUpdates() {
  const { data: session } = useSession();
  useNotificationStream(Boolean(session?.user));
  return null;
}
