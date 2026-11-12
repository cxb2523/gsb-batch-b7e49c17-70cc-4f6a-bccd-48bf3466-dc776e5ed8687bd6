import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspacesService } from './workspaces.service.js';
import { defineAbilityFor } from '../access/abilities.js';
import type { InstanceLimitsService } from '../access/instance-limits.service.js';
import type { Access } from '../access/access.types.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { WorkspaceRole } from '../access/roles.js';

function wrappedKey(version: number): string {
  const bytes = Buffer.alloc(1 + 4 + 32);
  bytes[0] = 0x01;
  bytes.writeUInt32BE(version, 1);
  return bytes.toString('base64url');
}

function accessWith(role: WorkspaceRole = 'owner', memberId = 'm-owner'): Access {
  return {
    user: { id: 'u-owner', name: 'Owner', email: 'owner@local.com' },
    workspace: { id: 'org-1', slug: 'acme' },
    workspaceRole: role,
    memberId,
    project: null,
    projectRole: null,
    boardId: null,
    ability: defineAbilityFor({ workspaceRole: role, projectRole: null }),
  };
}

function sessionAccess(): Access {
  return {
    user: { id: 'u-invitee', name: 'Invitee', email: 'invitee@local.com' },
    workspace: null,
    workspaceRole: null,
    memberId: null,
    project: null,
    projectRole: null,
    boardId: null,
    ability: defineAbilityFor({ workspaceRole: null, projectRole: null }),
  };
}

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new Error('expected at least one item');
  }
  return head;
}

function isLimitsService(val: unknown): val is InstanceLimitsService {
  return typeof val === 'object' && val !== null;
}

function createNotificationsMock() {
  return {
    invitationAccepted: vi.fn().mockResolvedValue(undefined),
    roleChanged: vi.fn().mockResolvedValue(undefined),
    removedFromWorkspace: vi.fn().mockResolvedValue(undefined),
  };
}

function isNotificationsService(val: unknown): val is NotificationsService {
  return typeof val === 'object' && val !== null;
}

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prismaMock: any;
  let blobPurgeMock: any;
  let configMock: any;
  let notificationsMock: ReturnType<typeof createNotificationsMock>;

  beforeEach(() => {
    prismaMock = {
      organization: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      member: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      invitation: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        deleteMany: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        findMany: vi.fn(),
      },
      project: { count: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      projectMember: {
        groupBy: vi.fn(),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      board: { count: vi.fn(), findMany: vi.fn() },
      boardFile: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findUnique: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    prismaMock.$transaction = vi.fn((callback: (tx: unknown) => unknown) => callback(prismaMock));
    blobPurgeMock = { enqueue: vi.fn().mockResolvedValue(undefined) };
    configMock = { get: vi.fn().mockReturnValue('http://localhost:5173') };
    const limitsMock: unknown = {
      checkWorkspaceLimit: vi.fn().mockResolvedValue(undefined),
      checkBoardLimit: vi.fn().mockResolvedValue(undefined),
      checkStorageLimit: vi.fn().mockResolvedValue(undefined),
    };
    if (!isLimitsService(limitsMock)) throw new Error();
    notificationsMock = createNotificationsMock();
    if (!isNotificationsService(notificationsMock)) throw new Error();
    service = new WorkspacesService(
      prismaMock,
      blobPurgeMock,
      configMock,
      limitsMock,
      notificationsMock,
    );
  });

  describe('getWorkspace', () => {
    it('returns the organization, the caller role and their wrapped key', async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        _count: { members: 3, projects: 1 },
      });
      prismaMock.member.findUnique.mockResolvedValue({ encryptedOrgKey: 'wrapped' });
      prismaMock.board.count.mockResolvedValue(4);

      const result = await service.getWorkspace(accessWith());

      expect(result).toMatchObject({
        id: 'org-1',
        currentUserRole: 'owner',
        encryptedOrgKey: 'wrapped',
        _count: { members: 3, projects: 1, boards: 4 },
      });
    });

    it('throws NotFound when the workspace is gone', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);
      await expect(service.getWorkspace(accessWith())).rejects.toThrow('Workspace not found');
    });
  });

  describe('createWorkspace', () => {
    const data = {
      id: '5b3c2f16-8f27-4d7e-9a67-3f27fdc5fd23',
      name: 'Studio North',
      encryptedOrgKey: 'wrapped-org-key',
      project: {
        id: '0f9a2f4e-7f8b-4b4e-9a3c-c3f6f4f0a1b2',
        name: 'First Project',
        encryptedProjectKey: 'wrapped-project-key',
        creatorEncryptedProjectKey: 'wrapped-creator-project-key',
      },
    };

    it('refuses a user whose only roles are editor or viewer', async () => {
      prismaMock.member.findMany.mockResolvedValue([{ role: 'editor' }]);

      await expect(service.createWorkspace(accessWith('editor'), data)).rejects.toThrow(
        'Only workspace owners and admins can create more workspaces',
      );
      expect(prismaMock.organization.create).not.toHaveBeenCalled();
    });

    it('creates the workspace, Owner and first project with their keys in one transaction', async () => {
      prismaMock.member.findMany.mockResolvedValue([]);
      prismaMock.organization.findMany.mockResolvedValue([]);
      prismaMock.organization.create.mockResolvedValue({
        id: 'org-new',
        slug: 'studio-north',
        name: 'Studio North',
      });
      prismaMock.member.create.mockResolvedValue({});
      prismaMock.project.create.mockResolvedValue({ id: 'p-new' });

      const result = await service.createWorkspace(accessWith('owner'), data);

      expect(result).toEqual({ id: 'org-new', slug: 'studio-north', name: 'Studio North' });
      expect(prismaMock.member.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-new',
          userId: 'u-owner',
          role: 'owner',
          encryptedOrgKey: 'wrapped-org-key',
        }),
      });
      expect(prismaMock.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: data.project.id,
          organizationId: 'org-new',
          encryptedProjectKey: 'wrapped-project-key',
          members: {
            create: expect.objectContaining({
              userId: 'u-owner',
              encryptedProjectKey: 'wrapped-creator-project-key',
            }),
          },
        }),
      });
    });

    it('reports a slug collision from the unique index as a conflict', async () => {
      prismaMock.member.findMany.mockResolvedValue([]);
      prismaMock.organization.findMany.mockResolvedValue([]);
      prismaMock.organization.create.mockRejectedValueOnce({ code: 'P2002' });

      await expect(service.createWorkspace(accessWith('owner'), data)).rejects.toThrow(
        'already being used',
      );
    });

    it('derives a readable slug and falls back for names with no Latin characters', async () => {
      prismaMock.member.findMany.mockResolvedValue([]);
      prismaMock.organization.findMany.mockResolvedValue([]);
      prismaMock.organization.create.mockImplementation(
        ({ data: created }: { data: { slug: string; name: string } }) =>
          Promise.resolve({ id: 'org-new', slug: created.slug, name: created.name }),
      );
      prismaMock.member.create.mockResolvedValue({});
      prismaMock.project.create.mockResolvedValue({ id: 'p-new' });

      const latin = await service.createWorkspace(accessWith('owner'), data);
      expect(latin.slug).toBe('studio-north');

      const nonLatin = await service.createWorkspace(accessWith('owner'), {
        ...data,
        name: '架构',
      });
      expect(nonLatin.slug).toMatch(/^workspace-[0-9a-f]{6}$/);
    });

    it('trims dashes at both ends of the slug, however long the name is', async () => {
      prismaMock.member.findMany.mockResolvedValue([]);
      prismaMock.organization.findMany.mockResolvedValue([]);
      prismaMock.organization.create.mockImplementation(
        ({ data: created }: { data: { slug: string; name: string } }) =>
          Promise.resolve({ id: 'org-new', slug: created.slug, name: created.name }),
      );
      prismaMock.member.create.mockResolvedValue({});
      prismaMock.project.create.mockResolvedValue({ id: 'p-new' });

      const dashed = await service.createWorkspace(accessWith('owner'), {
        ...data,
        name: `--${'a-'.repeat(40)}--`,
      });
      // The 60-character cut would end on a dash, so that dash is dropped too.
      expect(dashed.slug).toBe('a-'.repeat(29) + 'a');
    });
  });

  describe('updateWorkspace', () => {
    it('rejects an empty name', async () => {
      await expect(service.updateWorkspace(accessWith(), { name: '  ' })).rejects.toThrow(
        'Workspace name cannot be empty',
      );
      expect(prismaMock.organization.update).not.toHaveBeenCalled();
    });

    it('renames the workspace', async () => {
      prismaMock.organization.update.mockResolvedValue({ id: 'org-1', name: 'Renamed' });

      await service.updateWorkspace(accessWith(), { name: ' Renamed ' });

      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'Renamed' },
      });
    });
  });

  describe('getWorkspaceMembers', () => {
    it('reports every project for administrators and only assignments for others', async () => {
      prismaMock.member.findMany.mockResolvedValue([
        {
          id: 'm1',
          userId: 'u1',
          role: 'owner',
          createdAt: new Date('2026-01-01'),
          user: { id: 'u1', name: 'Owner', email: 'o@x.io', image: null },
        },
        {
          id: 'm2',
          userId: 'u2',
          role: 'editor',
          createdAt: new Date('2026-01-02'),
          user: { id: 'u2', name: 'Editor', email: 'e@x.io', image: null },
        },
      ]);
      prismaMock.projectMember.groupBy.mockResolvedValue([
        { userId: 'u2', _count: { projectId: 1 } },
      ]);
      prismaMock.project.count.mockResolvedValue(4);
      prismaMock.member.count.mockResolvedValue(2);

      const result = await service.getWorkspaceMembers(accessWith());

      expect(result.items).toEqual([
        expect.objectContaining({ userId: 'u1', assignedProjectsCount: 4 }),
        expect.objectContaining({ userId: 'u2', assignedProjectsCount: 1 }),
      ]);
      expect(result.pagination).toMatchObject({ page: 1, limit: 20, total: 2 });
      expect(prismaMock.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('returns the same paginated shape even without query parameters', async () => {
      prismaMock.member.count.mockResolvedValue(25);
      prismaMock.member.findMany.mockResolvedValue([]);
      prismaMock.projectMember.groupBy.mockResolvedValue([]);
      prismaMock.project.count.mockResolvedValue(0);

      const result = await service.getWorkspaceMembers(accessWith(), { page: 2, limit: 20 });

      expect(result).toMatchObject({
        pagination: {
          page: 2,
          limit: 20,
          total: 25,
          totalPages: 2,
          hasNextPage: false,
          hasPrevPage: true,
        },
      });
    });
  });

  describe('inviteMember', () => {
    const base = { email: 'new@local.com' };

    it('rejects any role other than editor or viewer', async () => {
      await expect(service.inviteMember(accessWith(), { ...base, role: 'admin' })).rejects.toThrow(
        'may only grant the editor or viewer role',
      );
      await expect(
        service.inviteMember(accessWith(), { ...base, role: 'workspace-member' }),
      ).rejects.toThrow('may only grant the editor or viewer role');
      expect(prismaMock.invitation.create).not.toHaveBeenCalled();
    });

    it('defaults to editor and returns an invite url', async () => {
      prismaMock.member.findFirst.mockResolvedValue(null);
      prismaMock.invitation.deleteMany.mockResolvedValue({ count: 0 });
      prismaMock.invitation.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: data.id, ...data }),
      );

      const invitation = await service.inviteMember(accessWith(), base);

      expect(prismaMock.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'editor', inviterId: 'u-owner' }),
      });
      expect(invitation.inviteUrl).toContain('/invite/');
    });

    it('rejects inviting somebody who is already a member', async () => {
      prismaMock.member.findFirst.mockResolvedValue({ id: 'm1' });

      await expect(service.inviteMember(accessWith(), base)).rejects.toThrow(
        'already a member of this workspace',
      );
    });
  });

  describe('getWorkspaceInvitations', () => {
    it('marks expired pending invitations and falls back to editor for a null role', async () => {
      prismaMock.invitation.findMany.mockResolvedValue([
        {
          id: 'i1',
          email: 'a@x.io',
          role: null,
          status: 'pending',
          expiresAt: new Date('2020-01-01'),
          createdAt: new Date('2019-12-01'),
          user: { id: 'u1', name: 'Owner', email: 'o@x.io' },
        },
      ]);

      const invitation = first(await service.getWorkspaceInvitations(accessWith()));

      expect(invitation.role).toBe('editor');
      expect(invitation.status).toBe('expired');
    });
  });

  describe('revokeInvitation', () => {
    it('throws NotFound for an invitation in another workspace', async () => {
      prismaMock.invitation.findFirst.mockResolvedValue(null);

      await expect(service.revokeInvitation(accessWith(), 'i1')).rejects.toThrow(
        'Invitation not found',
      );
      expect(prismaMock.invitation.update).not.toHaveBeenCalled();
    });

    it('marks the invitation revoked so an open link can say it is no longer valid', async () => {
      prismaMock.invitation.findFirst.mockResolvedValue({ id: 'i1' });

      await expect(service.revokeInvitation(accessWith(), 'i1')).resolves.toEqual({
        success: true,
        message: 'Invitation revoked successfully',
      });
      expect(prismaMock.invitation.update).toHaveBeenCalledWith({
        where: { id: 'i1' },
        data: { status: 'revoked' },
      });
    });
  });

  describe('updateMemberRole', () => {
    it('rejects an unknown or owner role', async () => {
      await expect(service.updateMemberRole(accessWith(), 'm2', 'owner')).rejects.toThrow(
        'Invalid role',
      );
      await expect(service.updateMemberRole(accessWith(), 'm2', 'member')).rejects.toThrow(
        'Invalid role',
      );
    });

    it('throws NotFound for a member of another workspace', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm2',
        organizationId: 'org-2',
        role: 'editor',
        encryptedOrgKey: null,
      });

      await expect(service.updateMemberRole(accessWith(), 'm2', 'viewer')).rejects.toThrow(
        'Member not found in this workspace',
      );
    });

    it('never lets an admin change their own role, and changes nothing', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm-admin',
        organizationId: 'org-1',
        role: 'admin',
        userId: 'u-owner',
        encryptedOrgKey: 'admin-key',
      });

      await expect(
        service.updateMemberRole(accessWith('admin', 'm-admin'), 'm-admin', 'editor'),
      ).rejects.toThrow('You cannot change your own role');
      expect(prismaMock.member.update).not.toHaveBeenCalled();
    });

    it('never lets an owner change another owner through the member route', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm-other-owner',
        organizationId: 'org-1',
        role: 'owner',
        encryptedOrgKey: 'owner-key',
      });

      await expect(
        service.updateMemberRole(accessWith('owner'), 'm-other-owner', 'editor'),
      ).rejects.toThrow('You may not change this member');
      expect(prismaMock.member.update).not.toHaveBeenCalled();
    });

    it('refuses an admin who tries to change an owner', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm-owner',
        organizationId: 'org-1',
        role: 'owner',
        encryptedOrgKey: 'owner-key',
      });

      await expect(
        service.updateMemberRole(accessWith('admin', 'm-admin'), 'm-owner', 'editor'),
      ).rejects.toThrow('You may not change this member');
      expect(prismaMock.member.update).not.toHaveBeenCalled();
    });

    it('requires the wrapped key for a promotion and writes both fields', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm2',
        organizationId: 'org-1',
        role: 'editor',
        encryptedOrgKey: null,
      });

      await expect(service.updateMemberRole(accessWith(), 'm2', 'admin')).rejects.toThrow(
        'requires their wrapped workspace key',
      );

      prismaMock.organization.findUniqueOrThrow.mockResolvedValue({ keyVersion: 1 });
      prismaMock.member.update.mockResolvedValue({ id: 'm2', role: 'admin' });
      const validKey = wrappedKey(1);
      await service.updateMemberRole(accessWith(), 'm2', 'admin', validKey);

      expect(prismaMock.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: 'admin', encryptedOrgKey: validKey },
        }),
      );
    });

    it('clears the key and marks rotation due when an admin is demoted', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm2',
        organizationId: 'org-1',
        role: 'admin',
        userId: 'u2',
        encryptedOrgKey: 'admin-key',
      });
      prismaMock.project.findMany.mockResolvedValue([]);
      prismaMock.organization.update.mockResolvedValue({ id: 'org-1' });
      prismaMock.member.update.mockResolvedValue({ id: 'm2', role: 'viewer' });

      await service.updateMemberRole(accessWith(), 'm2', 'viewer');

      expect(prismaMock.member.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: 'viewer', encryptedOrgKey: null } }),
      );
      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-1' },
          data: { keyRotationDue: true },
        }),
      );
      expect(notificationsMock.roleChanged).toHaveBeenCalledWith({
        userId: 'u2',
        workspaceId: 'org-1',
        role: 'viewer',
      });
    });

    it('does not tell a person whose role stayed the same', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm2',
        organizationId: 'org-1',
        role: 'editor',
        userId: 'u2',
        encryptedOrgKey: null,
      });
      prismaMock.member.update.mockResolvedValue({ id: 'm2', role: 'editor' });

      await service.updateMemberRole(accessWith(), 'm2', 'editor');

      expect(notificationsMock.roleChanged).not.toHaveBeenCalled();
    });
  });

  describe('transferOwnership', () => {
    it('demotes the old owner before promoting the target, and keeps the old key', async () => {
      prismaMock.member.findUnique
        .mockResolvedValueOnce({ id: 'm-owner', role: 'owner' })
        .mockResolvedValueOnce({
          id: 'm-target',
          organizationId: 'org-1',
          userId: 'u2',
          role: 'admin',
          encryptedOrgKey: 'target-key',
        });
      prismaMock.member.update.mockResolvedValue({});
      prismaMock.member.findUniqueOrThrow.mockResolvedValue({ id: 'm-target', role: 'owner' });

      await service.transferOwnership(prismaMock, 'org-1', 'u-owner', 'm-target');

      const calls = prismaMock.member.update.mock.calls;
      expect(calls[0][0]).toEqual({ where: { id: 'm-owner' }, data: { role: 'admin' } });
      expect(calls[1][0]).toEqual({ where: { id: 'm-target' }, data: { role: 'owner' } });
    });

    it('refuses a caller who is not the owner', async () => {
      prismaMock.member.findUnique
        .mockResolvedValueOnce({ id: 'm-admin', role: 'admin' })
        .mockResolvedValueOnce({ id: 'm-target', organizationId: 'org-1' });

      await expect(
        service.transferOwnership(prismaMock, 'org-1', 'u-admin', 'm-target'),
      ).rejects.toThrow('Only the workspace owner can transfer ownership');
    });

    it('refuses a target who does not hold the workspace key', async () => {
      prismaMock.member.findUnique
        .mockResolvedValueOnce({ id: 'm-owner', role: 'owner' })
        .mockResolvedValueOnce({
          id: 'm-target',
          organizationId: 'org-1',
          userId: 'u2',
          role: 'editor',
          encryptedOrgKey: null,
        });

      await expect(
        service.transferOwnership(prismaMock, 'org-1', 'u-owner', 'm-target'),
      ).rejects.toThrow('does not hold the workspace key');
    });

    it('refuses to transfer a workspace to its current owner', async () => {
      prismaMock.member.findUnique
        .mockResolvedValueOnce({ id: 'm-owner', role: 'owner' })
        .mockResolvedValueOnce({
          id: 'm-owner',
          organizationId: 'org-1',
          userId: 'u-owner',
          role: 'owner',
          encryptedOrgKey: 'key',
        });

      await expect(
        service.transferOwnership(prismaMock, 'org-1', 'u-owner', 'm-owner'),
      ).rejects.toThrow('You already own this workspace');
    });
  });

  describe('removeMember', () => {
    it('throws NotFound when the target is not in the workspace', async () => {
      prismaMock.member.findUnique.mockResolvedValue(null);
      await expect(service.removeMember(accessWith(), 'm2')).rejects.toThrow(
        'Member not found in this workspace',
      );
    });

    it('refuses to remove an owner', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm-owner',
        organizationId: 'org-1',
        role: 'owner',
        userId: 'u-owner',
        user: { id: 'u-owner', email: 'owner@local.com' },
      });

      await expect(service.removeMember(accessWith(), 'm-owner')).rejects.toThrow(
        'You may not remove this member',
      );
    });

    it('revokes the membership and its grants in one transaction', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm2',
        organizationId: 'org-1',
        role: 'editor',
        userId: 'u2',
        user: { id: 'u2', email: 'editor@local.com' },
      });
      prismaMock.projectMember.findMany.mockResolvedValue([]);
      prismaMock.projectMember.deleteMany.mockResolvedValue({ count: 1 });
      prismaMock.invitation.deleteMany.mockResolvedValue({ count: 0 });
      prismaMock.member.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeMember(accessWith(), 'm2');

      expect(prismaMock.projectMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u2', project: { organizationId: 'org-1' } },
      });
      expect(prismaMock.member.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', userId: 'u2' },
      });
      expect(notificationsMock.removedFromWorkspace).toHaveBeenCalledWith({
        userId: 'u2',
        workspaceId: 'org-1',
      });
    });

    it('tells nobody when the removal is refused', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'm-owner',
        organizationId: 'org-1',
        role: 'owner',
        userId: 'u-owner',
        user: { id: 'u-owner', email: 'owner@local.com' },
      });

      await expect(service.removeMember(accessWith(), 'm-owner')).rejects.toThrow();

      expect(notificationsMock.removedFromWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('deleteWorkspace', () => {
    it('queues stored objects and deletes the workspace in one transaction', async () => {
      prismaMock.board.findMany.mockResolvedValue([{ id: 'b1', keyVersion: 1 }]);
      prismaMock.boardFile.findMany.mockResolvedValue([
        { boardId: 'b1', fileId: 'f1', keyVersion: 1 },
      ]);
      prismaMock.organization.delete.mockResolvedValue({ id: 'org-1' });

      await service.deleteWorkspace(accessWith());

      expect(blobPurgeMock.enqueue).toHaveBeenCalledWith(prismaMock, [
        'boards/b1/v1.bin',
        'boards/b1/v1/files/f1.bin',
      ]);
      expect(prismaMock.organization.delete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    });
  });

  describe('getInvitation', () => {
    it('shows the invited address only in masked form', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue({
        email: 'qaribhaider@gmail.com',
        role: 'editor',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
        organization: { name: 'Acme' },
        user: { name: 'Owner' },
      });

      const preview = await service.getInvitation('i1');

      expect(preview.emailHint).toBe('q***@gmail.com');
      expect(JSON.stringify(preview)).not.toContain('qaribhaider');
    });
  });

  describe('isInvitationRecipient', () => {
    it('is true for the invited account, whatever the letter case', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue({ email: 'Invitee@Local.com' });

      await expect(service.isInvitationRecipient(sessionAccess(), 'i1')).resolves.toEqual({
        isRecipient: true,
      });
    });

    it('is false for any other account', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue({ email: 'someone-else@local.com' });

      await expect(service.isInvitationRecipient(sessionAccess(), 'i1')).resolves.toEqual({
        isRecipient: false,
      });
    });

    it('refuses an unknown invitation like the public lookup does', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue(null);

      await expect(service.isInvitationRecipient(sessionAccess(), 'missing')).rejects.toThrow(
        'not valid or has expired',
      );
    });
  });

  describe('acceptInvitation', () => {
    const invitation = {
      id: 'i1',
      organizationId: 'org-1',
      email: 'invitee@local.com',
      role: 'editor',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      projectIds: ['p1'],
      organization: { id: 'org-1', slug: 'acme' },
    };

    it('refuses an invitation addressed to another email', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue(invitation);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u-invitee', email: 'other@local.com' });

      await expect(service.acceptInvitation(sessionAccess(), 'i1')).rejects.toThrow(
        'sent to a different email address',
      );
    });

    it('rejects an expired invitation', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue({
        ...invitation,
        expiresAt: new Date('2020-01-01'),
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u-invitee',
        email: 'invitee@local.com',
      });

      await expect(service.acceptInvitation(sessionAccess(), 'i1')).rejects.toThrow(
        'This invitation has expired',
      );
    });

    it('claims the invitation, creates the membership and assigns projects', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue(invitation);
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u-invitee',
        email: 'invitee@local.com',
      });
      prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.member.findFirst.mockResolvedValue(null);
      prismaMock.member.create.mockResolvedValue({ id: 'm-new' });
      prismaMock.project.findMany.mockResolvedValue([{ id: 'p1' }]);
      prismaMock.projectMember.createMany.mockResolvedValue({ count: 1 });
      prismaMock.projectMember.count.mockResolvedValue(1);

      const result = await service.acceptInvitation(sessionAccess(), 'i1');

      expect(result).toMatchObject({
        success: true,
        organizationId: 'org-1',
        pendingProjectGrants: 1,
      });
      expect(prismaMock.member.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'editor' }),
      });
      expect(prismaMock.projectMember.createMany).toHaveBeenCalledWith({
        data: [
          {
            projectId: 'p1',
            userId: 'u-invitee',
            role: 'editor',
            encryptedProjectKey: null,
          },
        ],
        skipDuplicates: true,
      });
    });

    it('tells the workspace administrators who joined and how many projects wait for access', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue(invitation);
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u-invitee',
        email: 'invitee@local.com',
      });
      prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.member.findFirst.mockResolvedValue(null);
      prismaMock.member.create.mockResolvedValue({ id: 'm-new' });
      prismaMock.project.findMany.mockResolvedValue([{ id: 'p1' }]);
      prismaMock.projectMember.createMany.mockResolvedValue({ count: 1 });
      prismaMock.projectMember.count.mockResolvedValue(1);

      await service.acceptInvitation(sessionAccess(), 'i1');

      expect(notificationsMock.invitationAccepted).toHaveBeenCalledWith({
        workspaceId: 'org-1',
        personId: 'u-invitee',
        projectsWaiting: 1,
      });
    });

    it('tells nobody again when the invitation was already accepted', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue({ ...invitation, status: 'accepted' });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u-invitee',
        email: 'invitee@local.com',
      });

      const result = await service.acceptInvitation(sessionAccess(), 'i1');

      expect(result).toMatchObject({ alreadyAccepted: true });
      expect(notificationsMock.invitationAccepted).not.toHaveBeenCalled();
    });

    it('tells nobody when the acceptance is refused', async () => {
      prismaMock.invitation.findUnique.mockResolvedValue(invitation);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u-invitee', email: 'other@local.com' });

      await expect(service.acceptInvitation(sessionAccess(), 'i1')).rejects.toThrow();

      expect(notificationsMock.invitationAccepted).not.toHaveBeenCalled();
    });
  });
});
