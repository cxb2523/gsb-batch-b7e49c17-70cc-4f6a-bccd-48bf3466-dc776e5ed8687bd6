import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination } from '@/components/Pagination';
import { useSession } from '@/lib/auth-client';
import { errorMessage } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/date';
import { cn } from '@/lib/utils';
import { markAllNotificationsRead, markNotificationRead } from '../api';
import { notificationKeys } from '../keys';
import { describeNotification } from '../notification-text';
import { useNotifications, useUnreadNotificationCount } from '../queries';
import { refreshAfterNotification } from '../refresh';
import type { Notification } from '../schemas';

/** The bell in the header: an unread count, and the inbox in a small panel. */
export function NotificationBell() {
  const { data: session } = useSession();
  const signedIn = Boolean(session?.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState(1);

  const unread = useUnreadNotificationCount(signedIn).data ?? 0;
  const inbox = useNotifications(page, signedIn && isOpen);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const readAgain = () => queryClient.invalidateQueries({ queryKey: notificationKeys.all });

  const open = async (notification: Notification) => {
    const { href } = describeNotification(notification);
    if (!notification.readAt) {
      try {
        await markNotificationRead(notification.id);
        void readAgain();
      } catch (err) {
        toast.error(errorMessage(err) ?? 'The notification could not be marked as read.');
      }
    }
    if (href) {
      // Read what the notification is about again first, so the page it opens is not a stale one.
      refreshAfterNotification(queryClient);
      setIsOpen(false);
      void navigate(href);
    }
  };

  const markAllRead = async () => {
    try {
      await markAllNotificationsRead();
      void readAgain();
    } catch (err) {
      toast.error(errorMessage(err) ?? 'The notifications could not be marked as read.');
    }
  };

  if (!signedIn) return null;

  const items = inbox.data?.items ?? [];
  const pagination = inbox.data?.pagination;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={isOpen}
        className="relative flex items-center justify-center w-8 h-8 text-ink-muted hover:text-ink bg-white hover:bg-paper border border-border rounded-lg shadow-2xs transition-colors cursor-pointer"
      >
        <Bell className="w-3.5 h-3.5" />
        {unread > 0 && (
          <span
            data-testid="unread-count"
            className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-ink text-white font-mono text-[9px] font-semibold flex items-center justify-center"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-border rounded-2xl shadow-2xl p-3 z-50 flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between px-1 pb-2 border-b border-border-subtle">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted font-bold">
              Notifications
            </span>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unread === 0}
              className="text-[11px] font-semibold text-ink hover:underline disabled:text-ink-subtle disabled:no-underline cursor-pointer disabled:cursor-default"
            >
              Mark all as read
            </button>
          </div>

          {inbox.isError ? (
            <div className="px-1 py-4 text-center text-ink-muted">
              <p>Your notifications could not be loaded.</p>
              <button
                type="button"
                onClick={() => void inbox.refetch()}
                className="mt-2 font-semibold text-ink hover:underline cursor-pointer"
              >
                Try again
              </button>
            </div>
          ) : inbox.isPending ? (
            <p className="px-1 py-4 text-center text-ink-muted">Loading...</p>
          ) : items.length === 0 ? (
            <p className="px-1 py-4 text-center text-ink-muted leading-relaxed">
              Nothing new. Invitations accepted and access changes show up here.
            </p>
          ) : (
            <ul className="flex flex-col max-h-96 overflow-y-auto">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => void open(notification)}
                    className={cn(
                      'w-full text-left px-2.5 py-2 rounded-lg hover:bg-paper flex items-start gap-2 cursor-pointer',
                      !notification.readAt && 'bg-surface',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1.5 w-1.5 h-1.5 rounded-full shrink-0',
                        notification.readAt ? 'bg-transparent' : 'bg-ink',
                      )}
                    />
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-ink leading-snug">
                        {describeNotification(notification).text}
                      </span>
                      <span className="font-mono text-[10px] text-ink-muted">
                        {formatRelativeTime(notification.createdAt)}
                        {notification.readAt ? '' : ' · unread'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pagination && pagination.totalPages > 1 && (
            <Pagination
              page={pagination.page}
              limit={pagination.limit}
              total={pagination.total}
              hasPrevPage={pagination.hasPrevPage}
              hasNextPage={pagination.hasNextPage}
              onPrev={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => current + 1)}
              entityName="NOTIFICATIONS"
            />
          )}
        </div>
      )}
    </div>
  );
}
