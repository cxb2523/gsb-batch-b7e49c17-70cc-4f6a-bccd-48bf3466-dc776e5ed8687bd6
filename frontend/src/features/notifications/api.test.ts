import { describe, it, expect, afterEach, vi } from 'vitest';
import { jsonResponse, errorResponse } from '@/test/http';
import { stubFetchRoutes, requestsTo, urlOf } from '@/test/route-fetch';
import { ApiError } from '@/lib/http';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';

const pagination = {
  page: 2,
  limit: 20,
  total: 25,
  totalPages: 2,
  hasNextPage: false,
  hasPrevPage: true,
};

describe('notifications api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listNotifications asks for the page and reads items and paging', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications': () =>
        jsonResponse({
          items: [
            {
              id: 'n1',
              kind: 'role_changed',
              workspaceId: 'w1',
              data: { workspaceName: 'Acme', role: 'viewer' },
              readAt: null,
              createdAt: '2026-10-28T10:00:00.000Z',
            },
          ],
          pagination,
        }),
    });

    const result = await listNotifications(2);

    const [firstCall] = requestsTo(fetchMock, 'GET /api/notifications');
    expect(firstCall ? urlOf(firstCall[0]) : '').toContain('page=2');
    expect(result.items[0]?.kind).toBe('role_changed');
    expect(result.pagination.hasPrevPage).toBe(true);
  });

  it('listNotifications refuses an answer that is not a list', async () => {
    stubFetchRoutes({ 'GET /api/notifications': () => jsonResponse({ items: 'nope' }) });

    await expect(listNotifications(1)).rejects.toBeInstanceOf(ApiError);
  });

  it('getUnreadNotificationCount returns the count', async () => {
    stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 3 }),
    });

    await expect(getUnreadNotificationCount()).resolves.toBe(3);
  });

  it('markNotificationRead posts to that notification', async () => {
    const fetchMock = stubFetchRoutes({
      'POST /api/notifications/n1/read': () => jsonResponse({ id: 'n1' }, { status: 201 }),
    });

    await markNotificationRead('n1');

    expect(requestsTo(fetchMock, 'POST /api/notifications/n1/read')).toHaveLength(1);
  });

  it('markNotificationRead passes on why the server refused', async () => {
    stubFetchRoutes({
      'POST /api/notifications/n9/read': () =>
        errorResponse(404, 'NOT_FOUND', 'Notification not found'),
    });

    await expect(markNotificationRead('n9')).rejects.toMatchObject({
      status: 404,
      message: 'Notification not found',
    });
  });

  it('markAllNotificationsRead posts once', async () => {
    const fetchMock = stubFetchRoutes({
      'POST /api/notifications/read-all': () => jsonResponse({ updated: 2 }, { status: 201 }),
    });

    await markAllNotificationsRead();

    expect(requestsTo(fetchMock, 'POST /api/notifications/read-all')).toHaveLength(1);
  });
});
