import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotFoundException, type MessageEvent } from '@nestjs/common';
import { firstValueFrom, take, toArray } from 'rxjs';
import { HEARTBEAT_MS, NotificationsService } from './notifications.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function isPrisma(value: unknown): value is PrismaService {
  return typeof value === 'object' && value !== null;
}

function createPrismaMock() {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'Ivy Invitee' }) },
    organization: { findUnique: vi.fn().mockResolvedValue({ name: 'Acme' }) },
    project: { findUnique: vi.fn().mockResolvedValue({ name: 'Roadmap' }) },
    member: { findMany: vi.fn().mockResolvedValue([]) },
    notification: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prismaMock: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    if (!isPrisma(prismaMock)) throw new Error('invalid prisma stub');
    service = new NotificationsService(prismaMock);
  });

  describe('invitationAccepted', () => {
    it('writes one notification per owner or admin, without telling the person who joined', async () => {
      prismaMock.member.findMany.mockResolvedValue([
        { userId: 'u-owner' },
        { userId: 'u-admin' },
        { userId: 'u-ivy' },
      ]);

      await service.invitationAccepted({
        workspaceId: 'w1',
        personId: 'u-ivy',
        projectsWaiting: 2,
      });

      expect(prismaMock.member.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'w1', role: { in: ['owner', 'admin'] } },
        select: { userId: true },
      });
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'u-owner',
            workspaceId: 'w1',
            kind: 'invitation_accepted',
            data: { workspaceName: 'Acme', personName: 'Ivy Invitee', projectsWaiting: 2 },
          },
          {
            userId: 'u-admin',
            workspaceId: 'w1',
            kind: 'invitation_accepted',
            data: { workspaceName: 'Acme', personName: 'Ivy Invitee', projectsWaiting: 2 },
          },
        ],
      });
    });

    it('writes nothing when nobody else can be told', async () => {
      prismaMock.member.findMany.mockResolvedValue([{ userId: 'u-ivy' }]);

      await service.invitationAccepted({
        workspaceId: 'w1',
        personId: 'u-ivy',
        projectsWaiting: 0,
      });

      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });

    it('falls back to plain words when a name cannot be found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.organization.findUnique.mockResolvedValue(null);
      prismaMock.member.findMany.mockResolvedValue([{ userId: 'u-owner' }]);

      await service.invitationAccepted({
        workspaceId: 'w1',
        personId: 'u-ivy',
        projectsWaiting: 0,
      });

      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            data: { workspaceName: 'a workspace', personName: 'Someone', projectsWaiting: 0 },
          }),
        ],
      });
    });
  });

  it('accessGranted names the project and the workspace', async () => {
    await service.accessGranted({ userId: 'u2', workspaceId: 'w1', projectId: 'p1' });

    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u2',
          workspaceId: 'w1',
          kind: 'access_granted',
          data: { workspaceName: 'Acme', projectId: 'p1', projectName: 'Roadmap' },
        },
      ],
    });
  });

  it('roleChanged carries the new role', async () => {
    await service.roleChanged({ userId: 'u2', workspaceId: 'w1', role: 'viewer' });

    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u2',
          workspaceId: 'w1',
          kind: 'role_changed',
          data: { workspaceName: 'Acme', role: 'viewer' },
        },
      ],
    });
  });

  it('projectRoleChanged names the project, the workspace and the new role', async () => {
    await service.projectRoleChanged({
      userId: 'u2',
      workspaceId: 'w1',
      projectId: 'p1',
      role: 'admin',
    });

    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u2',
          workspaceId: 'w1',
          kind: 'project_role_changed',
          data: { workspaceName: 'Acme', projectId: 'p1', projectName: 'Roadmap', role: 'admin' },
        },
      ],
    });
  });

  it('removedFromProject keeps the project name, which the person can no longer open', async () => {
    await service.removedFromProject({ userId: 'u2', workspaceId: 'w1', projectId: 'p1' });

    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u2',
          workspaceId: 'w1',
          kind: 'removed_from_project',
          data: { workspaceName: 'Acme', projectName: 'Roadmap' },
        },
      ],
    });
  });

  it('removedFromWorkspace keeps the workspace name, which the person can no longer look up', async () => {
    await service.removedFromWorkspace({ userId: 'u2', workspaceId: 'w1' });

    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u2',
          workspaceId: 'w1',
          kind: 'removed_from_workspace',
          data: { workspaceName: 'Acme' },
        },
      ],
    });
  });

  describe('when recording fails', () => {
    it('does not throw, so the action it describes is not undone', async () => {
      prismaMock.notification.createMany.mockRejectedValue(new Error('database is down'));

      await expect(
        service.roleChanged({ userId: 'u2', workspaceId: 'w1', role: 'viewer' }),
      ).resolves.toBeUndefined();
    });

    it('does not throw when a lookup fails either', async () => {
      prismaMock.organization.findUnique.mockRejectedValue(new Error('database is down'));

      await expect(
        service.removedFromWorkspace({ userId: 'u2', workspaceId: 'w1' }),
      ).resolves.toBeUndefined();
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('pages one person’s notifications, newest first', async () => {
      prismaMock.notification.count.mockResolvedValue(45);
      prismaMock.notification.findMany.mockResolvedValue([{ id: 'n1' }]);

      const result = await service.list('u1', { page: 2, limit: 20 });

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 20,
          take: 20,
        }),
      );
      expect(result.pagination).toEqual({
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: true,
      });
    });

    it('reports one empty page for an empty inbox', async () => {
      prismaMock.notification.count.mockResolvedValue(0);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const result = await service.list('u1', { page: 1, limit: 20 });

      expect(result.pagination).toMatchObject({
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });
  });

  it('unreadCount counts only the caller’s unread notifications', async () => {
    prismaMock.notification.count.mockResolvedValue(4);

    await expect(service.unreadCount('u1')).resolves.toEqual({ count: 4 });
    expect(prismaMock.notification.count).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
    });
  });

  describe('markRead', () => {
    it('marks the caller’s own unread notification read', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.markRead('u1', 'n1')).resolves.toEqual({ id: 'n1' });
      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('accepts one that is already read', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.notification.count.mockResolvedValue(1);

      await expect(service.markRead('u1', 'n1')).resolves.toEqual({ id: 'n1' });
    });

    it('refuses one that is not the caller’s or does not exist', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.notification.count.mockResolvedValue(0);

      await expect(service.markRead('u1', 'n-other')).rejects.toThrow(NotFoundException);
    });
  });

  it('markAllRead touches only the caller’s unread notifications', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.markAllRead('u1')).resolves.toEqual({ updated: 3 });
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  describe('streamFor', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts with a ready event, then says "changed" only for that person', async () => {
      const events: MessageEvent[] = [];
      const subscription = service.streamFor('u1').subscribe((event) => events.push(event));

      await service.roleChanged({ userId: 'u1', workspaceId: 'w1', role: 'viewer' });
      await service.roleChanged({ userId: 'u-other', workspaceId: 'w1', role: 'viewer' });
      subscription.unsubscribe();

      expect(events.map((event) => event.type)).toEqual(['ready', 'changed']);
      expect(events.every((event) => JSON.stringify(event.data) === '{}')).toBe(true);
    });

    it('tells a person once however many notifications were written for them together', async () => {
      prismaMock.member.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u1' }]);
      const events: MessageEvent[] = [];
      const subscription = service.streamFor('u1').subscribe((event) => events.push(event));

      await service.invitationAccepted({
        workspaceId: 'w1',
        personId: 'u-ivy',
        projectsWaiting: 0,
      });
      subscription.unsubscribe();

      expect(events.filter((event) => event.type === 'changed')).toHaveLength(1);
    });

    it('sends a heartbeat while it is quiet', async () => {
      vi.useFakeTimers();
      const received = firstValueFrom(service.streamFor('u1').pipe(take(2), toArray()));

      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

      expect((await received).map((event) => event.type)).toEqual(['ready', 'ping']);
    });
  });
});
