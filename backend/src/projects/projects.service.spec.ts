import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectsService } from './projects.service.js';
import { defineAbilityFor } from '../access/abilities.js';
import type { Access } from '../access/access.types.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProjectRole, WorkspaceRole } from '../access/roles.js';

/** A v1 envelope whose header holds one key version, the shape the server checks on a grant. */
function wrappedAtVersion(version: number, marker = 'k'): string {
  const bytes = Buffer.alloc(64);
  bytes[0] = 0x01;
  bytes.writeUInt32BE(version, 1);
  bytes.write(marker, 5, 'utf8');
  return bytes.toString('base64url');
}

const WRAPPED_V1 = wrappedAtVersion(1);

/** A project key wrapped under the workspace key: header `[projectVersion, workspaceVersion]`. */
function wrappedUnderWorkspace(projectVersion: number, workspaceVersion: number): string {
  const bytes = Buffer.alloc(64);
  bytes[0] = 0x01;
  bytes.writeUInt32BE(projectVersion, 1);
  bytes.writeUInt32BE(workspaceVersion, 5);
  return bytes.toString('base64url');
}

function createNotificationsMock() {
  return {
    accessGranted: vi.fn().mockResolvedValue(undefined),
    projectRoleChanged: vi.fn().mockResolvedValue(undefined),
    removedFromProject: vi.fn().mockResolvedValue(undefined),
  };
}

function isNotificationsService(val: unknown): val is NotificationsService {
  return typeof val === 'object' && val !== null;
}

function accessWith(context: {
  workspaceRole: WorkspaceRole;
  projectRole?: ProjectRole | null;
  workspaceId?: string;
  projectId?: string;
}): Access {
  const projectRole = context.projectRole ?? null;
  return {
    user: { id: 'user-1', name: 'User', email: 'user@local.com' },
    workspace: { id: context.workspaceId ?? 'org-1', slug: 'acme' },
    workspaceRole: context.workspaceRole,
    memberId: 'm1',
    project: context.projectId ? { id: context.projectId } : null,
    projectRole,
    boardId: null,
    ability: defineAbilityFor({
      workspaceRole: context.workspaceRole,
      projectRole,
      isAssignedToProject: projectRole !== null,
    }),
  };
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prismaMock: any;
  let blobPurgeMock: any;
  let notificationsMock: ReturnType<typeof createNotificationsMock>;

  beforeEach(() => {
    prismaMock = {
      project: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        delete: vi.fn(),
      },
      projectMember: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      member: { findUnique: vi.fn(), findMany: vi.fn() },
      organization: { findUniqueOrThrow: vi.fn() },
      board: { findMany: vi.fn() },
      boardFile: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    prismaMock.project.findUniqueOrThrow = vi.fn().mockResolvedValue({ keyVersion: 1 });
    prismaMock.$transaction = vi.fn((callback: (tx: unknown) => unknown) => callback(prismaMock));
    blobPurgeMock = { enqueue: vi.fn().mockResolvedValue(undefined) };
    notificationsMock = createNotificationsMock();
    if (!isNotificationsService(notificationsMock)) throw new Error();
    service = new ProjectsService(prismaMock, blobPurgeMock, notificationsMock);
  });

  describe('create', () => {
    it('creates the project in the resolved workspace and grants the creator project admin', async () => {
      const access = accessWith({ workspaceRole: 'admin' });
      prismaMock.project.create.mockResolvedValue({ id: 'p1', name: 'Core' });
      prismaMock.organization.findUniqueOrThrow.mockResolvedValue({ keyVersion: 1 });
      const workspaceWrapped = wrappedUnderWorkspace(1, 1);

      await service.create(access, 'p-new', 'Core', workspaceWrapped, 'creator-wrapped');

      expect(prismaMock.project.create).toHaveBeenCalledWith({
        data: {
          id: 'p-new',
          name: 'Core',
          organizationId: 'org-1',
          encryptedProjectKey: workspaceWrapped,
          members: {
            create: {
              userId: 'user-1',
              role: 'admin',
              encryptedProjectKey: 'creator-wrapped',
            },
          },
        },
        include: { members: true },
      });
    });

    it('refuses a project key wrapped under a workspace key version that moved on', async () => {
      const access = accessWith({ workspaceRole: 'admin' });
      prismaMock.organization.findUniqueOrThrow.mockResolvedValue({ keyVersion: 2 });

      await expect(
        service.create(access, 'p-new', 'Core', wrappedUnderWorkspace(1, 1), 'creator-wrapped'),
      ).rejects.toMatchObject({ response: { code: 'STALE_KEY_VERSION' } });
      expect(prismaMock.project.create).not.toHaveBeenCalled();
    });

    it('refuses a new project key that is not project version 1', async () => {
      const access = accessWith({ workspaceRole: 'admin' });

      await expect(
        service.create(access, 'p-new', 'Core', wrappedUnderWorkspace(2, 1), 'creator-wrapped'),
      ).rejects.toThrow('project version 1');
      expect(prismaMock.project.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('lists every project for a workspace administrator', async () => {
      const access = accessWith({ workspaceRole: 'admin' });
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.findAll(access);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
    });

    it('scopes the list to project assignments for everyone else', async () => {
      const access = accessWith({ workspaceRole: 'editor' });
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.findAll(access);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', members: { some: { userId: 'user-1' } } },
        }),
      );
    });

    it('enforces a minimum page size of 20 in paginated mode', async () => {
      const access = accessWith({ workspaceRole: 'admin' });
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.project.findMany.mockResolvedValue([]);

      const result = await service.findAll(access, { page: 1, limit: 5 });

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 0 }),
      );
      expect(result).toMatchObject({ pagination: { limit: 20 } });
    });
  });

  describe('update', () => {
    it('trims the new name', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.project.update.mockResolvedValue({ id: 'p1', name: 'Renamed' });

      await service.update(access, '  Renamed  ');

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Renamed' },
      });
    });

    it('rejects an empty name', async () => {
      const access = accessWith({ workspaceRole: 'admin', projectId: 'p1' });
      await expect(service.update(access, '   ')).rejects.toThrow('Project name cannot be empty');
    });
  });

  describe('delete', () => {
    it('queues the stored objects and deletes the project in one transaction', async () => {
      const access = accessWith({ workspaceRole: 'admin', projectId: 'p1' });
      prismaMock.board.findMany.mockResolvedValue([
        { id: 'b1', keyVersion: 1 },
        { id: 'b2', keyVersion: 2 },
      ]);
      prismaMock.boardFile.findMany.mockResolvedValue([
        { boardId: 'b1', fileId: 'f1', keyVersion: 1 },
      ]);
      prismaMock.project.delete.mockResolvedValue({ id: 'p1' });

      await service.delete(access);

      expect(blobPurgeMock.enqueue).toHaveBeenCalledWith(prismaMock, [
        'boards/b1/v1.bin',
        'boards/b2/v2.bin',
        'boards/b1/v1/files/f1.bin',
      ]);
      expect(prismaMock.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    it('does not delete the project when queueing the objects fails', async () => {
      const access = accessWith({ workspaceRole: 'admin', projectId: 'p1' });
      prismaMock.board.findMany.mockResolvedValue([{ id: 'b1', keyVersion: 1 }]);
      prismaMock.boardFile.findMany.mockResolvedValue([]);
      blobPurgeMock.enqueue.mockRejectedValue(new Error('queue unavailable'));

      await expect(service.delete(access)).rejects.toThrow('queue unavailable');
      expect(prismaMock.project.delete).not.toHaveBeenCalled();
    });
  });

  describe('project members', () => {
    it('maps explicit grants and workspace administrators once, without wrapped keys', async () => {
      const access = accessWith({ workspaceRole: 'admin', projectId: 'p1' });
      prismaMock.member.findMany.mockResolvedValue([
        {
          id: 'm1',
          userId: 'user-1',
          role: 'owner',
          createdAt: new Date('2025-01-01'),
          user: {
            id: 'user-1',
            name: 'Owner',
            email: 'owner@local.com',
            image: null,
          },
        },
      ]);
      prismaMock.projectMember.count.mockResolvedValue(1);
      prismaMock.projectMember.findMany.mockResolvedValue([
        {
          id: 'pm1',
          userId: 'u2',
          role: 'editor',
          encryptedProjectKey: null,
          createdAt: new Date('2026-01-01'),
          user: { id: 'u2', name: 'Sam', email: 'sam@local.com', image: null },
        },
      ]);

      const result = await service.getProjectMembers(access);

      expect(result.items).toEqual([
        {
          id: 'm1',
          userId: 'user-1',
          name: 'Owner',
          email: 'owner@local.com',
          image: null,
          role: 'admin',
          source: 'workspace',
          keyStatus: 'granted',
          createdAt: new Date('2025-01-01'),
        },
        {
          id: 'pm1',
          userId: 'u2',
          name: 'Sam',
          email: 'sam@local.com',
          image: null,
          role: 'editor',
          source: 'project',
          keyStatus: 'pending',
          createdAt: new Date('2026-01-01'),
        },
      ]);
      expect(result.pagination).toMatchObject({ page: 1, limit: 20, total: 2 });
      expect(JSON.stringify(result)).not.toContain('encryptedProjectKey');
    });

    it('rejects adding a user who is not a workspace member', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue(null);

      await expect(service.addProjectMember(access, 'u2', 'editor', WRAPPED_V1)).rejects.toThrow(
        'User is not a member of the workspace',
      );
      expect(prismaMock.projectMember.create).not.toHaveBeenCalled();
    });

    it('rejects a grant wrapped under an old project key version', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.project.findUniqueOrThrow.mockResolvedValue({ keyVersion: 2 });

      await expect(
        service.addProjectMember(access, 'u2', 'viewer', WRAPPED_V1),
      ).rejects.toMatchObject({ response: { code: 'STALE_KEY_VERSION' } });
      expect(prismaMock.projectMember.create).not.toHaveBeenCalled();
    });

    it('rejects a grant whose wrapped key has no readable version header', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });

      await expect(service.addProjectMember(access, 'u2', 'viewer', 'wrapped')).rejects.toThrow(
        'v1 wrap',
      );
      expect(prismaMock.projectMember.create).not.toHaveBeenCalled();
    });

    it('rejects a role outside the project vocabulary instead of silently defaulting', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm2' });

      await expect(
        service.addProjectMember(access, 'u2', 'workspace-member', 'wrapped'),
      ).rejects.toThrow('Invalid project role: workspace-member');
    });

    it('inserts a new assignment with the wrapped project key', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm2' });
      prismaMock.projectMember.findUnique.mockResolvedValue(null);
      prismaMock.projectMember.create.mockResolvedValue({ id: 'pm1' });

      await service.addProjectMember(access, 'u2', 'viewer', WRAPPED_V1);

      expect(prismaMock.projectMember.create).toHaveBeenCalledWith({
        data: {
          projectId: 'p1',
          userId: 'u2',
          role: 'viewer',
          encryptedProjectKey: WRAPPED_V1,
        },
      });
    });

    it('tells the person they were given access to the project', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm2' });
      prismaMock.projectMember.findUnique.mockResolvedValue({
        id: 'pm1',
        encryptedProjectKey: null,
      });
      prismaMock.projectMember.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.projectMember.findUniqueOrThrow.mockResolvedValue({ id: 'pm1' });

      await service.addProjectMember(access, 'u2', 'viewer', WRAPPED_V1);

      expect(notificationsMock.accessGranted).toHaveBeenCalledWith({
        userId: 'u2',
        workspaceId: 'org-1',
        projectId: 'p1',
      });
    });

    it('does not notify the person who grants access to themselves', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm1' });
      prismaMock.projectMember.findUnique.mockResolvedValue(null);
      prismaMock.projectMember.create.mockResolvedValue({ id: 'pm1' });

      await service.addProjectMember(access, 'user-1', 'viewer', WRAPPED_V1);

      expect(notificationsMock.accessGranted).not.toHaveBeenCalled();
    });

    it('tells nobody when the grant is refused because the person already has the key', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm2' });
      prismaMock.projectMember.findUnique.mockResolvedValue({
        id: 'pm1',
        encryptedProjectKey: 'their-existing-key',
      });

      await expect(service.addProjectMember(access, 'u2', 'viewer', WRAPPED_V1)).rejects.toThrow();

      expect(notificationsMock.accessGranted).not.toHaveBeenCalled();
    });

    it('rejects adding somebody who already has a grant instead of overwriting it', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm2' });
      prismaMock.projectMember.findUnique.mockResolvedValue({
        id: 'pm1',
        encryptedProjectKey: 'their-existing-key',
      });

      await expect(
        service.addProjectMember(access, 'u2', 'viewer', wrappedAtVersion(1, 'attacker')),
      ).rejects.toThrow('already has access to the project');
      expect(prismaMock.projectMember.create).not.toHaveBeenCalled();
      expect(prismaMock.projectMember.updateMany).not.toHaveBeenCalled();
    });

    it('fills a missing key once, without touching the existing role', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm2' });
      prismaMock.projectMember.findUnique.mockResolvedValue({
        id: 'pm1',
        encryptedProjectKey: null,
      });
      prismaMock.projectMember.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.projectMember.findUniqueOrThrow.mockResolvedValue({ id: 'pm1' });

      await service.addProjectMember(access, 'u2', 'viewer', WRAPPED_V1);

      expect(prismaMock.projectMember.updateMany).toHaveBeenCalledWith({
        where: { id: 'pm1', encryptedProjectKey: null },
        data: { encryptedProjectKey: WRAPPED_V1 },
      });
      expect(prismaMock.projectMember.create).not.toHaveBeenCalled();
    });

    it('rejects a completion that loses the race, leaving the winner key untouched', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.member.findUnique.mockResolvedValue({ id: 'm2' });
      prismaMock.projectMember.findUnique.mockResolvedValue({
        id: 'pm1',
        encryptedProjectKey: null,
      });
      prismaMock.projectMember.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.addProjectMember(access, 'u2', 'viewer', wrappedAtVersion(1, 'loser')),
      ).rejects.toThrow('already has access to the project');
      expect(prismaMock.projectMember.update).not.toHaveBeenCalled();
    });

    it('rejects changing or removing an assignment that does not exist', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.projectMember.findUnique.mockResolvedValue(null);

      await expect(service.updateProjectMemberRole(access, 'u2', 'viewer')).rejects.toThrow(
        'User is not assigned to this project',
      );
      await expect(service.removeProjectMember(access, 'u2')).rejects.toThrow(
        'User is not assigned to this project',
      );
    });

    describe('telling a person their project role changed', () => {
      const projectAdmin = () =>
        accessWith({ workspaceRole: 'editor', projectRole: 'admin', projectId: 'p1' });

      it('notifies them with the new role', async () => {
        prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm1', role: 'editor' });
        prismaMock.projectMember.update.mockResolvedValue({ id: 'pm1', role: 'admin' });

        await service.updateProjectMemberRole(projectAdmin(), 'u2', 'admin');

        expect(notificationsMock.projectRoleChanged).toHaveBeenCalledWith({
          userId: 'u2',
          workspaceId: 'org-1',
          projectId: 'p1',
          role: 'admin',
        });
      });

      it('says nothing when the role stayed the same', async () => {
        prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm1', role: 'editor' });
        prismaMock.projectMember.update.mockResolvedValue({ id: 'pm1', role: 'editor' });

        await service.updateProjectMemberRole(projectAdmin(), 'u2', 'editor');

        expect(notificationsMock.projectRoleChanged).not.toHaveBeenCalled();
      });

      it('says nothing to the person who changed their own role', async () => {
        prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm1', role: 'admin' });
        prismaMock.projectMember.update.mockResolvedValue({ id: 'pm1', role: 'viewer' });

        await service.updateProjectMemberRole(projectAdmin(), 'user-1', 'viewer');

        expect(notificationsMock.projectRoleChanged).not.toHaveBeenCalled();
      });
    });

    it('removes an existing assignment', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'admin',
        projectId: 'p1',
      });
      prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm1' });
      prismaMock.projectMember.delete.mockResolvedValue({ id: 'pm1' });

      await service.removeProjectMember(access, 'u2');

      expect(prismaMock.projectMember.delete).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 'p1', userId: 'u2' } },
      });
    });

    describe('telling a person they were taken off the project', () => {
      const projectAdmin = () =>
        accessWith({ workspaceRole: 'editor', projectRole: 'admin', projectId: 'p1' });

      it('notifies them once the removal has gone through', async () => {
        prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm1' });
        prismaMock.projectMember.delete.mockResolvedValue({ id: 'pm1' });

        await service.removeProjectMember(projectAdmin(), 'u2');

        expect(notificationsMock.removedFromProject).toHaveBeenCalledWith({
          userId: 'u2',
          workspaceId: 'org-1',
          projectId: 'p1',
        });
      });

      it('says nothing to the person who removed themselves', async () => {
        prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm1' });
        prismaMock.projectMember.delete.mockResolvedValue({ id: 'pm1' });

        await service.removeProjectMember(projectAdmin(), 'user-1');

        expect(notificationsMock.removedFromProject).not.toHaveBeenCalled();
      });

      it('says nothing when there was no assignment to remove', async () => {
        prismaMock.projectMember.findUnique.mockResolvedValue(null);

        await expect(service.removeProjectMember(projectAdmin(), 'u2')).rejects.toThrow();

        expect(notificationsMock.removedFromProject).not.toHaveBeenCalled();
      });
    });
  });
});
