import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useSession } from '@/lib/auth-client';
import { NotificationUpdates } from './NotificationUpdates';

const stream = vi.hoisted(() => ({ useNotificationStream: vi.fn() }));
vi.mock('../hooks/useNotificationStream', () => stream);
vi.mock('@/lib/auth-client', () => ({ useSession: vi.fn() }));

function mockSession(signedIn: boolean) {
  const now = new Date();
  vi.mocked(useSession).mockReturnValue({
    data: signedIn
      ? {
          user: {
            id: 'u1',
            createdAt: now,
            updatedAt: now,
            email: 'u1@local.com',
            emailVerified: true,
            name: 'User',
            image: null,
            isAnonymous: false,
          },
          session: {
            id: 's1',
            token: 't1',
            userId: 'u1',
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + 86_400_000),
            ipAddress: null,
            userAgent: null,
            activeOrganizationId: null,
          },
        }
      : null,
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe('NotificationUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the live connection on while somebody is signed in', () => {
    mockSession(true);

    render(<NotificationUpdates />);

    expect(stream.useNotificationStream).toHaveBeenCalledWith(true);
  });

  it('turns it off for a signed-out visitor', () => {
    mockSession(false);

    render(<NotificationUpdates />);

    expect(stream.useNotificationStream).toHaveBeenCalledWith(false);
  });
});
