import { http, validateResponse } from '@/lib/http';
import { NotificationListSchema, UnreadCountSchema, type NotificationList } from './schemas';

export async function listNotifications(page: number): Promise<NotificationList> {
  const data = await http.get(`/api/notifications?page=${page}`);
  return validateResponse(NotificationListSchema, data, 'GET /api/notifications');
}

export async function getUnreadNotificationCount(): Promise<number> {
  const data = await http.get('/api/notifications/unread-count');
  return validateResponse(UnreadCountSchema, data, 'GET /api/notifications/unread-count').count;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await http.post(`/api/notifications/${notificationId}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await http.post('/api/notifications/read-all');
}
