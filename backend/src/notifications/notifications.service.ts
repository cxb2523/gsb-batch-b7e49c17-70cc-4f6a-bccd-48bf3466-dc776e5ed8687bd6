import { Injectable, Logger, NotFoundException, type MessageEvent } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { filter, interval, map, merge, Subject, startWith, type Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { WORKSPACE_ADMINISTRATOR_ROLES } from '../access/roles.js';
import type { NotificationKind } from './notification-kinds.js';

/** Keeps proxies from closing a stream that is quiet. */
export const HEARTBEAT_MS = 25_000;

/** What a row needs; the caller names the people, the service looks up the names to show. */
interface NewNotification {
  userId: string;
  workspaceId: string;
  kind: NotificationKind;
  data: Prisma.InputJsonObject;
}

/**
 * The in-app inbox. Recording is best effort and never throws: a notification is a courtesy, and a
 * failure to write one must not undo the action it describes. Rows hold the kind and names that
 * are stored in the clear anyway; nothing from a canvas.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  /** User ids with something new. Held in this process only; the client refetches on reconnect. */
  private readonly changed = new Subject<string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Somebody accepted an invitation: the people who can grant them access are told. */
  async invitationAccepted(params: {
    workspaceId: string;
    personId: string;
    projectsWaiting: number;
  }): Promise<void> {
    const { workspaceId, personId, projectsWaiting } = params;
    await this.record(async () => {
      const [person, workspaceName, administrators] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: personId }, select: { name: true } }),
        this.workspaceName(workspaceId),
        this.prisma.member.findMany({
          where: { organizationId: workspaceId, role: { in: [...WORKSPACE_ADMINISTRATOR_ROLES] } },
          select: { userId: true },
        }),
      ]);
      const personName = person?.name ?? 'Someone';
      return administrators
        .filter((administrator) => administrator.userId !== personId)
        .map((administrator) => ({
          userId: administrator.userId,
          workspaceId,
          kind: 'invitation_accepted' as const,
          data: { workspaceName, personName, projectsWaiting },
        }));
    });
  }

  /** A person was given the key to a project and can open it now. */
  async accessGranted(params: {
    userId: string;
    workspaceId: string;
    projectId: string;
  }): Promise<void> {
    const { userId, workspaceId, projectId } = params;
    await this.record(async () => {
      const [workspaceName, project] = await Promise.all([
        this.workspaceName(workspaceId),
        this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      ]);
      return [
        {
          userId,
          workspaceId,
          kind: 'access_granted' as const,
          data: { workspaceName, projectId, projectName: project?.name ?? 'a project' },
        },
      ];
    });
  }

  /** A person's role in the workspace changed. */
  async roleChanged(params: { userId: string; workspaceId: string; role: string }): Promise<void> {
    const { userId, workspaceId, role } = params;
    await this.record(async () => [
      {
        userId,
        workspaceId,
        kind: 'role_changed' as const,
        data: { workspaceName: await this.workspaceName(workspaceId), role },
      },
    ]);
  }

  /** A person's role inside one project changed. */
  async projectRoleChanged(params: {
    userId: string;
    workspaceId: string;
    projectId: string;
    role: string;
  }): Promise<void> {
    const { userId, workspaceId, projectId, role } = params;
    await this.record(async () => {
      const [workspaceName, project] = await Promise.all([
        this.workspaceName(workspaceId),
        this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      ]);
      return [
        {
          userId,
          workspaceId,
          kind: 'project_role_changed' as const,
          data: { workspaceName, projectId, projectName: project?.name ?? 'a project', role },
        },
      ];
    });
  }

  /** A person was taken off one project; the project name is kept because they can no longer open it. */
  async removedFromProject(params: {
    userId: string;
    workspaceId: string;
    projectId: string;
  }): Promise<void> {
    const { userId, workspaceId, projectId } = params;
    await this.record(async () => {
      const [workspaceName, project] = await Promise.all([
        this.workspaceName(workspaceId),
        this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      ]);
      return [
        {
          userId,
          workspaceId,
          kind: 'removed_from_project' as const,
          data: { workspaceName, projectName: project?.name ?? 'a project' },
        },
      ];
    });
  }

  /** A person was removed from the workspace; the name is kept because they can no longer look it up. */
  async removedFromWorkspace(params: { userId: string; workspaceId: string }): Promise<void> {
    const { userId, workspaceId } = params;
    await this.record(async () => [
      {
        userId,
        workspaceId,
        kind: 'removed_from_workspace' as const,
        data: { workspaceName: await this.workspaceName(workspaceId) },
      },
    ]);
  }

  async list(userId: string, pagination: { page: number; limit: number }) {
    const { page, limit } = pagination;
    const where = { userId };
    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          kind: true,
          workspaceId: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  /** Reading one is idempotent; one that is not the caller's looks like one that does not exist. */
  async markRead(userId: string, notificationId: string): Promise<{ id: string }> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.notification.count({
        where: { id: notificationId, userId },
      });
      if (exists === 0) throw new NotFoundException('Notification not found');
    }
    return { id: notificationId };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /**
   * What the person's open page listens to. It says only that something changed; the page asks for
   * the list itself, so nothing about a notification travels on the stream.
   */
  streamFor(userId: string): Observable<MessageEvent> {
    const changes = this.changed.pipe(
      filter((changedUserId) => changedUserId === userId),
      map((): MessageEvent => ({ type: 'changed', data: {} })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );
    return merge(changes, heartbeat).pipe(startWith<MessageEvent>({ type: 'ready', data: {} }));
  }

  private async workspaceName(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.organization.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    return workspace?.name ?? 'a workspace';
  }

  private async record(build: () => Promise<NewNotification[]>): Promise<void> {
    try {
      const entries = await build();
      if (entries.length === 0) return;
      await this.prisma.notification.createMany({ data: entries });
      for (const userId of new Set(entries.map((entry) => entry.userId))) {
        this.changed.next(userId);
      }
    } catch (error) {
      this.logger.warn(
        `A notification could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
