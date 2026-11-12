import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../src/config/env.schema.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  DataCleanupService,
  READ_NOTIFICATION_RETENTION_DAYS,
} from '../src/privacy/data-cleanup.service.js';

function isConfigService(val: unknown): val is ConfigService<EnvConfig, true> {
  return typeof val === 'object' && val !== null;
}

function createPrismaMock() {
  return {
    session: { deleteMany: vi.fn() },
    invitation: { deleteMany: vi.fn() },
    signupAttempt: { deleteMany: vi.fn() },
    notification: { deleteMany: vi.fn() },
  };
}

function isPrismaService(val: unknown): val is PrismaService {
  return typeof val === 'object' && val !== null;
}

describe('Data Minimization & Automated Cleanup (GDPR Art. 5)', () => {
  let cleanupService: DataCleanupService;
  let prismaMock: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    if (!isPrismaService(prismaMock)) throw new Error('invalid prisma stub');
    const config: unknown = { get: () => 3600 };
    if (!isConfigService(config)) throw new Error('invalid config stub');
    cleanupService = new DataCleanupService(prismaMock, config);
  });

  it('purgeExpiredSessions deletes sessions with expiresAt in the past', async () => {
    prismaMock.session.deleteMany.mockResolvedValue({ count: 12 });

    const count = await cleanupService.purgeExpiredSessions();

    expect(count).toBe(12);
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: expect.any(Date) },
      },
    });
  });

  it('purgeExpiredInvitations deletes invitations that expired or are marked expired', async () => {
    prismaMock.invitation.deleteMany.mockResolvedValue({ count: 5 });

    const count = await cleanupService.purgeExpiredInvitations();

    expect(count).toBe(5);
    expect(prismaMock.invitation.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ expiresAt: { lt: expect.any(Date) } }, { status: 'expired' }],
      },
    });
  });

  it('purgeExpiredSignupAttempts deletes signup attempts older than the window', async () => {
    prismaMock.signupAttempt.deleteMany.mockResolvedValue({ count: 7 });

    const count = await cleanupService.purgeExpiredSignupAttempts();

    expect(count).toBe(7);
    expect(prismaMock.signupAttempt.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: expect.any(Date) },
      },
    });
  });

  it('purgeReadNotifications deletes only notifications read more than a month ago', async () => {
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 4 });

    const count = await cleanupService.purgeReadNotifications();

    expect(count).toBe(4);
    const call = prismaMock.notification.deleteMany.mock.calls[0]?.[0];
    const cutoff: Date = call.where.readAt.lt;
    const days = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(READ_NOTIFICATION_RETENTION_DAYS, 1);
    // An unread notification has no `readAt`, so it can never match a `lt` filter.
    expect(Object.keys(call.where)).toEqual(['readAt']);
  });

  it('runCleanup aggregates the purge counts and returns ISO timestamp', async () => {
    prismaMock.session.deleteMany.mockResolvedValue({ count: 8 });
    prismaMock.invitation.deleteMany.mockResolvedValue({ count: 3 });
    prismaMock.signupAttempt.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 6 });

    const result = await cleanupService.runCleanup();

    expect(result.sessionsPurged).toBe(8);
    expect(result.invitationsPurged).toBe(3);
    expect(result.signupAttemptsPurged).toBe(2);
    expect(result.notificationsPurged).toBe(6);
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('handleDailyScheduledCleanup triggers runCleanup', async () => {
    const spy = vi.spyOn(cleanupService, 'runCleanup').mockResolvedValue({
      sessionsPurged: 10,
      invitationsPurged: 2,
      signupAttemptsPurged: 1,
      notificationsPurged: 0,
      timestamp: new Date().toISOString(),
    });

    await cleanupService.handleDailyScheduledCleanup();

    expect(spy).toHaveBeenCalled();
  });
});
