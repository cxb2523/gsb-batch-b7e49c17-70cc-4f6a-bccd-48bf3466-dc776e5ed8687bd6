import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from '../src/users/users.service.js';
import { UsersController } from '../src/users/users.controller.js';
import { NotFoundException } from '@nestjs/common';

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new Error('expected at least one item');
  }
  return head;
}

describe('GDPR Data Portability & Access (GET /api/user/export-data)', () => {
  let usersService: UsersService;
  let usersController: UsersController;
  let prismaMock: any;
  let workspacesServiceMock: any;

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: vi.fn(),
      },
      board: {
        findMany: vi.fn(),
      },
    };
    workspacesServiceMock = {
      deleteWorkspaceWithin: vi.fn(),
    };
    const configServiceMock = { get: vi.fn(() => 'development') } as any;
    usersService = new UsersService(prismaMock, workspacesServiceMock, configServiceMock);
    usersController = new UsersController(usersService, configServiceMock);
  });

  it('throws NotFoundException if user is not found during export', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(usersService.exportUserData('usr-nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('returns structured machine-readable GDPR bundle with anonymized IPs and encrypted zero-knowledge notices', async () => {
    const mockUser = {
      id: 'usr-1',
      name: 'Alice Developer',
      email: 'alice@company.com',
      emailVerified: true,
      image: 'https://avatar.local/alice.png',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
      kdfSalt: 'salt-123',
      keyWrapIv: 'iv-456',
      publicKey: 'spki-pub-key',
      wrappedPrivateKey: 'ciphertext-priv-key',
      accounts: [
        {
          id: 'acc-1',
          providerId: 'github',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      sessions: [
        {
          id: 'sess-1',
          createdAt: new Date('2026-03-01T00:00:00Z'),
          expiresAt: new Date('2026-03-08T00:00:00Z'),
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          ipAddress: '192.168.1.144',
        },
        {
          id: 'sess-2',
          createdAt: new Date('2026-03-02T00:00:00Z'),
          expiresAt: new Date('2026-03-09T00:00:00Z'),
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
          ipAddress: '2001:db8:85a3:8d3:1319:8a2e:370:7348',
        },
      ],
      members: [
        {
          organizationId: 'org-1',
          role: 'owner',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          organization: {
            id: 'org-1',
            name: 'Acme Corp',
            slug: 'acme',
          },
        },
      ],
      projectMembers: [
        {
          projectId: 'proj-1',
          role: 'admin',
          createdAt: new Date('2026-01-02T00:00:00Z'),
          project: {
            id: 'proj-1',
            name: 'Core Infrastructure',
            organizationId: 'org-1',
          },
        },
      ],
      invitations: [
        {
          id: 'inv-1',
          organizationId: 'org-1',
          email: 'colleague@company.com',
          role: 'editor',
          status: 'pending',
          expiresAt: new Date('2026-04-01T00:00:00Z'),
          createdAt: new Date('2026-03-01T00:00:00Z'),
        },
      ],
    };

    prismaMock.user.findUnique.mockResolvedValue(mockUser);
    prismaMock.board.findMany.mockResolvedValue([
      {
        id: 'board-1',
        title: 'System Architecture 2026',
        projectId: 'proj-1',
        createdAt: new Date('2026-01-05T00:00:00Z'),
        updatedAt: new Date('2026-01-10T00:00:00Z'),
      },
    ]);

    const result = await usersService.exportUserData('usr-1');

    // Verify metadata
    expect(result.exportMetadata).toBeDefined();
    expect(result.exportMetadata.legalBasis).toContain('GDPR Article 15');
    expect(result.exportMetadata.legalBasis).toContain('Article 20');
    expect(result.exportMetadata.notice).toContain('does not hold the key');

    // Verify profile & identity
    expect(result.profile.id).toBe('usr-1');
    expect(result.profile.email).toBe('alice@company.com');
    expect(result.profile.e2eeIdentity.hasEncryptedPrivateKey).toBe(true);

    // Verify IP anonymization
    expect(first(result.activeSessions).ipAddress).toBe('192.168.1.xxx');
    expect(first(result.activeSessions.slice(1)).ipAddress).toBe(
      '2001:db8:85a3:xxxx:xxxx:xxxx:xxxx',
    );

    // Verify memberships and diagrams
    expect(result.workspaceMemberships).toHaveLength(1);
    expect(first(result.workspaceMemberships).organizationName).toBe('Acme Corp');
    expect(result.projectMemberships).toHaveLength(1);
    expect(first(result.projectMemberships).projectName).toBe('Core Infrastructure');
    expect(result.diagramsMetadata).toHaveLength(1);
    expect(first(result.diagramsMetadata).isEncryptedZeroKnowledge).toBe(true);
    expect(result.invitationsSent).toHaveLength(1);
  });

  it('UsersController.exportData sets attachment headers and returns JSON payload', async () => {
    const mockExport = {
      exportMetadata: { legalBasis: 'GDPR' },
      profile: { id: 'usr-1', email: 'test@local.com' },
    };
    vi.spyOn(usersService, 'exportUserData').mockResolvedValue(mockExport as any);

    const mockReq = { user: { id: 'usr-1' } } as any;
    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;

    await usersController.exportData(mockReq.user, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="canvhq-data-export-usr-1-'),
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.send).toHaveBeenCalledWith(JSON.stringify(mockExport, null, 2));
  });
});
