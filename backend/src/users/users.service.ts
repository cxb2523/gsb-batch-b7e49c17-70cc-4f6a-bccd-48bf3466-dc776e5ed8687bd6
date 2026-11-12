import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { WORKSPACE_OWNER_ROLE } from '../access/roles.js';
import type { EnvConfig } from '../config/env.schema.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async updateProfile(userId: string, data: { name?: string | undefined }) {
    if (!data.name || data.name.trim().length === 0) {
      throw new BadRequestException('Name cannot be empty');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: data.name.trim() },
      select: { id: true, name: true, email: true, image: true },
    });

    return updated;
  }

  async getEncryptionParams(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kdfSalt: true,
        keyWrapIv: true,
        wrappedPrivateKey: true,
        publicKey: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async setupEncryption(
    userId: string,
    data: { kdfSalt: string; keyWrapIv: string; wrappedPrivateKey: string; publicKey: string },
  ) {
    if (!data.kdfSalt || !data.keyWrapIv || !data.wrappedPrivateKey || !data.publicKey) {
      throw new BadRequestException('All encryption identity parameters are required');
    }

    // Check-and-write in one statement: two concurrent first-time set-ups cannot both win, and
    // the loser cannot replace the key pair the winner just stored.
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, publicKey: null },
      data: {
        kdfSalt: data.kdfSalt,
        keyWrapIv: data.keyWrapIv,
        wrappedPrivateKey: data.wrappedPrivateKey,
        publicKey: data.publicKey,
      },
    });

    if (claimed.count === 0) {
      const exists = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException('User not found');
      }
      throw new ConflictException('Encryption is already initialized for this account');
    }

    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        kdfSalt: true,
        keyWrapIv: true,
        wrappedPrivateKey: true,
        publicKey: true,
      },
    });
  }

  async rotatePassphrase(
    userId: string,
    data: { kdfSalt: string; keyWrapIv: string; wrappedPrivateKey: string },
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { wrappedPrivateKey: true },
    });
    if (!existing?.wrappedPrivateKey) {
      throw new BadRequestException('Encryption must be initialized before changing passphrase');
    }

    if (!data.kdfSalt || !data.keyWrapIv || !data.wrappedPrivateKey) {
      throw new BadRequestException('kdfSalt, keyWrapIv, and wrappedPrivateKey are required');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        kdfSalt: data.kdfSalt,
        keyWrapIv: data.keyWrapIv,
        wrappedPrivateKey: data.wrappedPrivateKey,
      },
      select: {
        kdfSalt: true,
        keyWrapIv: true,
        wrappedPrivateKey: true,
      },
    });
  }

  /**
   * A public key is only visible to its owner and to people who share a workspace with them.
   * The response carries no name or email: it exists to wrap a key for a colleague, nothing else.
   */
  async getPublicKey(targetUserId: string, requesterId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, publicKey: true },
    });

    if (!user || !user.publicKey) {
      throw new NotFoundException('Public key not found');
    }

    if (targetUserId !== requesterId) {
      const sharedWorkspace = await this.prisma.member.findFirst({
        where: {
          userId: requesterId,
          organization: { members: { some: { userId: targetUserId } } },
        },
        select: { id: true },
      });
      if (!sharedWorkspace) {
        throw new NotFoundException('Public key not found');
      }
    }

    return { id: user.id, publicKey: user.publicKey };
  }

  async getAccounts(userId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        providerId: true,
        createdAt: true,
      },
    });

    return accounts;
  }

  async unlinkAccount(userId: string, providerId: string) {
    const totalAccounts = await this.prisma.account.count({
      where: { userId },
    });

    if (totalAccounts <= 1 && !this.configService.get('ENABLE_DEV_LOGIN', { infer: true })) {
      throw new BadRequestException(
        'At least one connected login provider is required to access your account.',
      );
    }

    const targetAccount = await this.prisma.account.findFirst({
      where: { userId, providerId },
    });

    if (!targetAccount) {
      throw new NotFoundException(`Account provider '${providerId}' not found on this profile`);
    }

    await this.prisma.account.delete({
      where: { id: targetAccount.id },
    });

    return { success: true };
  }

  async getOwnedWorkspaces(userId: string) {
    const ownedMemberships = await this.prisma.member.findMany({
      where: { userId, role: WORKSPACE_OWNER_ROLE },
      include: {
        organization: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, name: true, email: true, image: true },
                },
              },
            },
          },
        },
      },
    });

    return ownedMemberships.map((m) => {
      const org = m.organization;
      const otherMembers = org.members
        .filter((mem) => mem.userId !== userId)
        .map((mem) => ({
          id: mem.id,
          userId: mem.userId,
          name: mem.user.name,
          email: mem.user.email,
          role: mem.role,
          // Only a member who holds the workspace key can take over a workspace.
          canReceiveOwnership: Boolean(mem.encryptedOrgKey),
        }));

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        totalMembersCount: org.members.length,
        otherMembers,
      };
    });
  }

  async deleteAccount(
    userId: string,
    options: {
      transfers?: Record<string, string> | undefined;
      confirmSoleDeletion?: boolean | undefined;
    } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Phase 1: decide what must happen to every owned workspace, without writing anything,
    // and report every problem at once.
    const ownedWorkspaces = await this.getOwnedWorkspaces(userId);
    const problems: string[] = [];
    const ownershipTransfers: Array<{ workspaceId: string; targetMemberId: string }> = [];
    const workspaceIdsToDelete: string[] = [];

    for (const workspace of ownedWorkspaces) {
      if (workspace.otherMembers.length === 0) {
        if (options.confirmSoleDeletion) {
          workspaceIdsToDelete.push(workspace.id);
        } else {
          problems.push(
            `You are the sole member of workspace '${workspace.name}'. Please confirm workspace deletion or invite team members first.`,
          );
        }
        continue;
      }

      const targetMemberId = options.transfers?.[workspace.id];
      if (!targetMemberId) {
        problems.push(
          `Workspace '${workspace.name}' requires selecting a new owner before account deletion`,
        );
        continue;
      }

      const target = workspace.otherMembers.find((member) => member.id === targetMemberId);
      if (!target) {
        problems.push(
          `Selected member for workspace '${workspace.name}' is invalid or does not belong to the workspace`,
        );
      } else if (!target.canReceiveOwnership) {
        problems.push(
          `${target.name} cannot take over workspace '${workspace.name}' because they do not hold its encryption key. Promote an admin first, or delete the workspace.`,
        );
      } else {
        ownershipTransfers.push({ workspaceId: workspace.id, targetMemberId: target.id });
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException({
        message: problems.join(' '),
        error: 'Bad Request',
        problems,
      });
    }

    // Phase 2: change everything in one transaction. Deleting the user removes their sessions,
    // linked accounts, memberships, project grants and wrapped keys through the database cascade.
    await this.prisma.$transaction(async (tx) => {
      // Every project this account could open needs a new project key after the account is gone.
      const memberships = await tx.member.findMany({
        where: { userId },
        select: { organizationId: true, role: true },
      });
      await Promise.all(
        memberships.map((membership) =>
          this.workspacesService.markRotationDue(
            tx,
            membership.organizationId,
            userId,
            membership.role,
          ),
        ),
      );

      // The same primitive the transfer route uses: demote the old owner, then promote the
      // member who holds the workspace key. Transfers belong to different workspaces, so they are
      // independent; the demote-then-promote order inside each one is what the index requires.
      await Promise.all(
        ownershipTransfers.map((transfer) =>
          this.workspacesService.transferOwnership(
            tx,
            transfer.workspaceId,
            userId,
            transfer.targetMemberId,
          ),
        ),
      );
      for (const workspaceId of workspaceIdsToDelete) {
        await this.workspacesService.deleteWorkspaceWithin(tx, workspaceId);
      }
      await tx.invitation.deleteMany({ where: { email: user.email } });
      await tx.user.delete({ where: { id: userId } });
    });

    return { success: true, message: 'Account and associated data deleted successfully' };
  }

  async exportUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          select: {
            id: true,
            providerId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        sessions: {
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            userAgent: true,
            ipAddress: true,
          },
        },
        members: {
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
        projectMembers: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                organizationId: true,
              },
            },
          },
        },
        invitations: {
          select: {
            id: true,
            organizationId: true,
            email: true,
            role: true,
            status: true,
            expiresAt: true,
            createdAt: true,
          },
        },
        notifications: {
          select: { id: true, kind: true, data: true, readAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const projectIds = user.projectMembers.map((pm: { projectId: string }) => pm.projectId);
    const boards = await this.prisma.board.findMany({
      where: {
        projectId: { in: projectIds },
      },
      select: {
        id: true,
        title: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      exportMetadata: {
        legalBasis: 'GDPR Article 15 (Right of Access) & Article 20 (Right to Data Portability)',
        exportTimestamp: new Date().toISOString(),
        controller: 'CanvHQ Platform',
        notice:
          'Diagram visual contents are encrypted in your browser using AES-GCM-256 and the server does not hold the key to read or decrypt them.',
      },
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        e2eeIdentity: {
          kdfSalt: user.kdfSalt,
          keyWrapIv: user.keyWrapIv,
          publicKey: user.publicKey,
          hasEncryptedPrivateKey: !!user.wrappedPrivateKey,
        },
      },
      connectedAccounts: user.accounts,
      activeSessions: user.sessions.map(
        (s: {
          id: string;
          createdAt: Date;
          expiresAt: Date;
          userAgent: string | null;
          ipAddress: string | null;
        }) => ({
          id: s.id,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          userAgent: s.userAgent,
          ipAddress: this.anonymizeIp(s.ipAddress),
        }),
      ),
      workspaceMemberships: user.members.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization?.name || 'Unknown',
        organizationSlug: m.organization?.slug || 'unknown',
        role: m.role,
        joinedAt: m.createdAt,
      })),
      projectMemberships: user.projectMembers.map((pm) => ({
        projectId: pm.projectId,
        projectName: pm.project?.name || 'Unknown',
        organizationId: pm.project?.organizationId || '',
        role: pm.role,
        joinedAt: pm.createdAt,
      })),
      diagramsMetadata: boards.map(
        (b: {
          id: string;
          title: string;
          projectId: string;
          createdAt: Date;
          updatedAt: Date;
        }) => ({
          id: b.id,
          title: b.title,
          projectId: b.projectId,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          isEncryptedZeroKnowledge: true,
        }),
      ),
      invitationsSent: user.invitations,
      notifications: user.notifications,
    };
  }

  private anonymizeIp(ip?: string | null): string | null {
    if (!ip) return null;
    if (ip.includes('.')) {
      return ip.replace(/\.\d+$/, '.xxx');
    }
    if (ip.includes(':')) {
      const parts = ip.split(':');
      return parts.slice(0, Math.min(parts.length, 3)).join(':') + ':xxxx:xxxx:xxxx:xxxx';
    }
    return 'xxx.xxx.xxx.xxx';
  }

  async getUserMetrics(userId: string) {
    const memberships = await this.prisma.member.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    const workspaceIds = memberships.map((m: { organizationId: string }) => m.organizationId);
    const workspacesCount = workspaceIds.length;

    let projectsCount = 0;
    if (workspaceIds.length > 0) {
      projectsCount = await this.prisma.project.count({
        where: {
          organizationId: { in: workspaceIds },
        },
      });
    }

    return {
      workspacesCount,
      projectsCount,
    };
  }
}
