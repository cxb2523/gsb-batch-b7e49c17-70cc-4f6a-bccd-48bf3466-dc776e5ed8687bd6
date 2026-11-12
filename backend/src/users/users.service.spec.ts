import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from './users.service.js';
import { BadRequestException, ConflictException } from '@nestjs/common';

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new Error('expected at least one item');
  }
  return head;
}

describe('UsersService', () => {
  let service: UsersService;
  let mockPrisma: any;
  let mockWorkspaces: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn((cb: (tx: typeof mockPrisma) => Promise<unknown>) => cb(mockPrisma)),
      user: {
        update: vi.fn(),
        updateMany: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        delete: vi.fn(),
      },
      account: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
      member: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      projectMember: {
        deleteMany: vi.fn(),
      },
      project: {
        deleteMany: vi.fn(),
      },
      board: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      invitation: {
        deleteMany: vi.fn(),
      },
      organization: {
        delete: vi.fn(),
      },
      session: {
        deleteMany: vi.fn(),
      },
    };

    mockWorkspaces = {
      deleteWorkspaceWithin: vi.fn().mockResolvedValue(undefined),
      transferOwnership: vi.fn().mockResolvedValue(undefined),
      markRotationDue: vi.fn().mockResolvedValue([]),
    };

    const mockConfigService: any = {
      get: vi.fn(() => false),
    };

    service = new UsersService(mockPrisma, mockWorkspaces, mockConfigService);
  });

  describe('updateProfile', () => {
    it('should update user name when valid', async () => {
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'usr_1',
        name: 'New Name',
        email: 'q@local.com',
      });

      const res = await service.updateProfile('usr_1', { name: 'New Name' });
      expect(res.name).toBe('New Name');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { name: 'New Name' },
        select: expect.any(Object),
      });
    });

    it('should throw BadRequestException if name is empty', async () => {
      await expect(service.updateProfile('usr_1', { name: '   ' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('unlinkAccount', () => {
    it('should reject unlinking if user only has 1 account', async () => {
      mockPrisma.account.count.mockResolvedValueOnce(1);

      await expect(service.unlinkAccount('usr_1', 'google')).rejects.toThrow(BadRequestException);
    });

    it('should allow unlinking if user has more than 1 account', async () => {
      mockPrisma.account.count.mockResolvedValueOnce(2);
      mockPrisma.account.findFirst.mockResolvedValueOnce({ id: 'acc_target' });
      mockPrisma.account.delete.mockResolvedValueOnce({ id: 'acc_target' });

      const res = await service.unlinkAccount('usr_1', 'google');
      expect(res.success).toBe(true);
      expect(mockPrisma.account.delete).toHaveBeenCalledWith({
        where: { id: 'acc_target' },
      });
    });
  });

  describe('getOwnedWorkspaces', () => {
    it('should return workspaces where user is owner with other members', async () => {
      mockPrisma.member.findMany.mockResolvedValueOnce([
        {
          organization: {
            id: 'org_1',
            name: 'Acme',
            slug: 'acme',
            members: [
              {
                id: 'mem_1',
                userId: 'usr_1',
                role: 'owner',
                user: { id: 'usr_1', name: 'Qarib', email: 'q@local.com' },
              },
              {
                id: 'mem_2',
                userId: 'usr_2',
                role: 'editor',
                user: { id: 'usr_2', name: 'Bob', email: 'bob@local.com' },
              },
            ],
          },
        },
      ]);

      const res = await service.getOwnedWorkspaces('usr_1');
      expect(res).toHaveLength(1);
      expect(first(res).name).toBe('Acme');
      expect(first(res).otherMembers).toHaveLength(1);
      expect(first(first(res).otherMembers).name).toBe('Bob');
    });
  });

  describe('deleteAccount', () => {
    it('should enforce ownership transfer when other members exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'usr_1' });
      // getOwnedWorkspaces
      mockPrisma.member.findMany.mockResolvedValueOnce([
        {
          organization: {
            id: 'org_1',
            name: 'Acme',
            members: [
              { id: 'mem_1', userId: 'usr_1', user: { name: 'Q' } },
              { id: 'mem_2', userId: 'usr_2', user: { name: 'Bob' } },
            ],
          },
        },
      ]);

      await expect(service.deleteAccount('usr_1', { transfers: {} })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should refuse to transfer ownership to a member who does not hold the workspace key', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'usr_1' });
      mockPrisma.member.findMany.mockResolvedValueOnce([
        {
          organization: {
            id: 'org_1',
            name: 'Acme',
            members: [
              { id: 'mem_1', userId: 'usr_1', user: { name: 'Q' } },
              { id: 'mem_2', userId: 'usr_2', user: { name: 'Bob' }, encryptedOrgKey: null },
            ],
          },
        },
      ]);

      await expect(
        service.deleteAccount('usr_1', { transfers: { org_1: 'mem_2' } }),
      ).rejects.toThrow(/encryption key/);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should change nothing when any one workspace cannot be resolved', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'usr_1' });
      mockPrisma.member.findMany.mockResolvedValueOnce([
        {
          organization: {
            id: 'org_sole',
            name: 'Sole Org',
            members: [{ id: 'mem_1', userId: 'usr_1', user: { name: 'Q' } }],
          },
        },
        {
          organization: {
            id: 'org_shared',
            name: 'Shared Org',
            members: [
              { id: 'mem_3', userId: 'usr_1', user: { name: 'Q' } },
              { id: 'mem_4', userId: 'usr_2', user: { name: 'Bob' } },
            ],
          },
        },
      ]);

      await expect(service.deleteAccount('usr_1', { confirmSoleDeletion: true })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockWorkspaces.deleteWorkspaceWithin).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('should transfer ownership and delete user successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'usr_1' });
      mockPrisma.member.findMany.mockResolvedValueOnce([
        {
          organization: {
            id: 'org_1',
            name: 'Acme',
            members: [
              { id: 'mem_1', userId: 'usr_1', user: { name: 'Q' } },
              {
                id: 'mem_2',
                userId: 'usr_2',
                user: { name: 'Bob' },
                encryptedOrgKey: 'wrapped-workspace-key',
              },
            ],
          },
        },
      ]);
      mockPrisma.member.findMany.mockResolvedValueOnce([
        { organizationId: 'org_1', role: 'owner' },
      ]);

      const res = await service.deleteAccount('usr_1', {
        transfers: { org_1: 'mem_2' },
      });

      expect(mockWorkspaces.transferOwnership).toHaveBeenCalledWith(
        mockPrisma,
        'org_1',
        'usr_1',
        'mem_2',
      );
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
      });
      expect(res.success).toBe(true);
    });

    it('should delete sole-owned workspace via WorkspacesService when confirmed', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'usr_1' });
      mockPrisma.member.findMany.mockResolvedValueOnce([
        {
          organization: {
            id: 'org_sole',
            name: 'Sole Org',
            members: [{ id: 'mem_1', userId: 'usr_1', user: { name: 'Q' } }],
          },
        },
      ]);
      mockPrisma.member.findMany.mockResolvedValueOnce([
        { organizationId: 'org_sole', role: 'owner' },
      ]);

      const res = await service.deleteAccount('usr_1', {
        confirmSoleDeletion: true,
      });

      expect(mockWorkspaces.deleteWorkspaceWithin).toHaveBeenCalledWith(mockPrisma, 'org_sole');
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
      });
      expect(res.success).toBe(true);
    });
  });

  describe('getUserMetrics', () => {
    it('should calculate workspace and project counts correctly', async () => {
      mockPrisma.member.findMany.mockResolvedValueOnce([
        { organizationId: 'org_1' },
        { organizationId: 'org_2' },
      ]);
      mockPrisma.project.count = vi.fn().mockResolvedValueOnce(5);

      const metrics = await service.getUserMetrics('usr_1');

      expect(mockPrisma.member.findMany).toHaveBeenCalledWith({
        where: { userId: 'usr_1' },
        select: { organizationId: true },
      });
      expect(mockPrisma.project.count).toHaveBeenCalledWith({
        where: {
          organizationId: { in: ['org_1', 'org_2'] },
        },
      });
      expect(metrics).toEqual({
        workspacesCount: 2,
        projectsCount: 5,
      });
    });

    it('should return 0 projects if user has no workspaces', async () => {
      mockPrisma.member.findMany.mockResolvedValueOnce([]);

      const metrics = await service.getUserMetrics('usr_none');

      expect(metrics).toEqual({
        workspacesCount: 0,
        projectsCount: 0,
      });
    });
  });

  describe('encryption methods', () => {
    it('setupEncryption stores identity parameters when not initialized', async () => {
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.user.findUniqueOrThrow.mockResolvedValueOnce({
        kdfSalt: 'salt',
        keyWrapIv: 'iv',
        wrappedPrivateKey: 'wrapped',
        publicKey: 'pub',
      });

      const res = await service.setupEncryption('usr_1', {
        kdfSalt: 'salt',
        keyWrapIv: 'iv',
        wrappedPrivateKey: 'wrapped',
        publicKey: 'pub',
      });

      expect(res.publicKey).toBe('pub');
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'usr_1', publicKey: null },
        data: {
          kdfSalt: 'salt',
          keyWrapIv: 'iv',
          wrappedPrivateKey: 'wrapped',
          publicKey: 'pub',
        },
      });
    });

    it('setupEncryption refuses an account that already has a public key', async () => {
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'usr_1' });

      await expect(
        service.setupEncryption('usr_1', {
          kdfSalt: 'salt',
          keyWrapIv: 'iv',
          wrappedPrivateKey: 'wrapped',
          publicKey: 'pub',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rotatePassphrase updates kdfSalt, keyWrapIv, and wrappedPrivateKey', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ wrappedPrivateKey: 'old_wrapped' });
      mockPrisma.user.update.mockResolvedValueOnce({
        kdfSalt: 'new_salt',
        keyWrapIv: 'new_iv',
        wrappedPrivateKey: 'new_wrapped',
      });

      const res = await service.rotatePassphrase('usr_1', {
        kdfSalt: 'new_salt',
        keyWrapIv: 'new_iv',
        wrappedPrivateKey: 'new_wrapped',
      });

      expect(res.wrappedPrivateKey).toBe('new_wrapped');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: {
          kdfSalt: 'new_salt',
          keyWrapIv: 'new_iv',
          wrappedPrivateKey: 'new_wrapped',
        },
        select: expect.any(Object),
      });
    });

    it('rotatePassphrase throws BadRequestException if not initialized yet', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ wrappedPrivateKey: null });

      await expect(
        service.rotatePassphrase('usr_1', {
          kdfSalt: 'new_salt',
          keyWrapIv: 'new_iv',
          wrappedPrivateKey: 'new_wrapped',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
