import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from '../src/users/users.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const soleOwnedWorkspace = {
  id: 'mem-1',
  organizationId: 'ws-1',
  role: 'owner',
  organization: {
    id: 'ws-1',
    name: 'Sole Workspace',
    slug: 'sole-ws',
    members: [{ id: 'mem-1', userId: 'usr-1', role: 'owner', user: { name: 'Owner' } }],
  },
};

const sharedWorkspace = {
  id: 'mem-2',
  organizationId: 'ws-2',
  role: 'owner',
  organization: {
    id: 'ws-2',
    name: 'Shared Workspace',
    slug: 'shared-ws',
    members: [
      { id: 'mem-2', userId: 'usr-1', role: 'owner', user: { name: 'Owner' } },
      {
        id: 'mem-3',
        userId: 'usr-2',
        role: 'admin',
        user: { name: 'Admin' },
        encryptedOrgKey: 'wrapped-workspace-key',
      },
    ],
  },
};

describe('GDPR Right to Erasure ("Right to be Forgotten", Art. 17 GDPR)', () => {
  let usersService: UsersService;
  let prismaMock: any;
  let workspacesServiceMock: any;

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn((callback: (tx: typeof prismaMock) => Promise<unknown>) =>
        callback(prismaMock),
      ),
      user: { findUnique: vi.fn(), delete: vi.fn() },
      member: { findMany: vi.fn(), updateMany: vi.fn() },
      invitation: { deleteMany: vi.fn() },
    };
    workspacesServiceMock = {
      deleteWorkspaceWithin: vi.fn(),
      transferOwnership: vi.fn().mockResolvedValue(undefined),
      markRotationDue: vi.fn().mockResolvedValue([]),
    };
    const configServiceMock = { get: vi.fn(() => false) } as any;
    usersService = new UsersService(prismaMock, workspacesServiceMock, configServiceMock);
  });

  it('throws NotFoundException when deleting a non-existent user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(usersService.deleteAccount('non-existent')).rejects.toThrow(NotFoundException);
  });

  it('refuses to delete a sole-owned workspace until the user confirms', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'usr-1', email: 'owner@local.com' });
    prismaMock.member.findMany.mockResolvedValue([soleOwnedWorkspace]);

    await expect(
      usersService.deleteAccount('usr-1', { confirmSoleDeletion: false }),
    ).rejects.toThrow(BadRequestException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('deletes the user, their sole workspace and invitations to their email in one transaction', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'usr-1', email: 'owner@local.com' });
    prismaMock.member.findMany.mockResolvedValue([soleOwnedWorkspace]);

    const result = await usersService.deleteAccount('usr-1', { confirmSoleDeletion: true });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(workspacesServiceMock.deleteWorkspaceWithin).toHaveBeenCalledWith(prismaMock, 'ws-1');
    expect(prismaMock.invitation.deleteMany).toHaveBeenCalledWith({
      where: { email: 'owner@local.com' },
    });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'usr-1' } });
    expect(result.success).toBe(true);
  });

  it('transfers a shared workspace to a member who holds its key, then deletes the user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'usr-1', email: 'owner@local.com' });
    prismaMock.member.findMany.mockResolvedValue([sharedWorkspace]);

    await expect(usersService.deleteAccount('usr-1', {})).rejects.toThrow(BadRequestException);
    expect(workspacesServiceMock.transferOwnership).not.toHaveBeenCalled();

    const result = await usersService.deleteAccount('usr-1', { transfers: { 'ws-2': 'mem-3' } });

    expect(workspacesServiceMock.transferOwnership).toHaveBeenCalledWith(
      prismaMock,
      'ws-2',
      'usr-1',
      'mem-3',
    );
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'usr-1' } });
    expect(result.success).toBe(true);
  });
});
