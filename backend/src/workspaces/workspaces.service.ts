import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '@prisma/client';
import { BlobPurgeService } from '../maintenance/blob-purge.service.js';
import type { EnvConfig } from '../config/env.schema.js';
import type { Access } from '../access/access.types.js';
import { canActOnMember } from '../access/abilities.js';
import { canCreateWorkspace } from '../access/workspace-creation.js';
import { InstanceLimitsService } from '../access/instance-limits.service.js';
import { readWrappedKeyVersions } from '../common/dto/wrapped-key.schema.js';
import { isSameEmail, maskEmail } from '../common/email.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  DEFAULT_INVITATION_ROLE,
  invitationRoleOrDefault,
  isInvitationRole,
  isWorkspaceAdminRole,
  isWorkspaceAdministrator,
  isWorkspaceOwner,
  isWorkspaceRole,
  projectRoleForInvitation,
  PROJECT_ADMIN_ROLE,
  WORKSPACE_ADMIN_ROLE,
  WORKSPACE_ADMINISTRATOR_ROLES,
  WORKSPACE_OWNER_ROLE,
} from '../access/roles.js';

type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

/** The one place an invitation's status is decided, for the list and for the public lookup. */
function invitationStatus(
  invitation: { status: string; expiresAt: Date },
  now = new Date(),
): InvitationStatus {
  if (invitation.status === 'accepted') return 'accepted';
  if (invitation.status === 'pending') {
    return now > new Date(invitation.expiresAt) ? 'expired' : 'pending';
  }
  return 'revoked';
}

/** How many boards one request to the re-key queue returns. */
const REKEY_QUEUE_PAGE_SIZE = 1000;

interface RekeyQueueBoard {
  boardId: string;
  projectId: string;
  keyVersion: number;
  projectKeyVersion: number;
  revision: number;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blobPurge: BlobPurgeService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly limitsService: InstanceLimitsService,
    private readonly notifications: NotificationsService,
  ) {}

  async getWorkspace(access: Access) {
    const workspaceId = this.requireWorkspace(access);

    const org = await this.prisma.organization.findUnique({
      where: { id: workspaceId },
      include: {
        _count: {
          select: { members: true, projects: true },
        },
      },
    });

    if (!org) {
      throw new NotFoundException('Workspace not found');
    }

    // `encryptedOrgKey` is the caller's own wrapped key, not authorization input, so it is read
    // here rather than carried on every resolved request.
    const membership = await this.prisma.member.findUnique({
      where: { id: access.memberId ?? '' },
      select: { encryptedOrgKey: true },
    });

    const totalBoards = await this.prisma.board.count({
      where: { project: { organizationId: workspaceId } },
    });

    const isAdmin = isWorkspaceAdministrator(access.workspaceRole);
    const { keyVersion, keyRotationDue, ...safeOrg } = org;

    return {
      ...safeOrg,
      ...(isAdmin ? { keyVersion, keyRotationDue } : {}),
      _count: {
        ...org._count,
        boards: totalBoards,
      },
      currentUserRole: access.workspaceRole,
      encryptedOrgKey: membership?.encryptedOrgKey ?? null,
    };
  }

  /**
   * Creates the workspace, its Owner membership and its first project in one transaction.
   *
   * Every key is supplied by the caller and required by the DTO: a workspace cannot exist
   * without its wrapped key, and the first project carries both its workspace-wrapped key and
   * the creator's own grant.
   */
  async createWorkspace(
    access: Access,
    data: {
      id: string;
      name: string;
      encryptedOrgKey: string;
      project: {
        id: string;
        name: string;
        encryptedProjectKey: string;
        creatorEncryptedProjectKey: string;
      };
    },
  ) {
    const baseSlug = this.slugBase(data.name);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // The rule is read inside the transaction, with the writes it guards.
        await this.limitsService.checkWorkspaceLimit(tx, access.user.id);

        const memberships = await tx.member.findMany({
          where: { userId: access.user.id },
          select: { role: true },
        });

        if (!canCreateWorkspace(memberships)) {
          throw new ForbiddenException(
            'Only workspace owners and admins can create more workspaces',
          );
        }

        const slug = await this.uniqueSlug(tx, baseSlug);
        const now = new Date();

        const organization = await tx.organization.create({
          data: {
            id: data.id,
            name: data.name.trim(),
            slug,
            createdAt: now,
          },
          select: { id: true, slug: true, name: true, keyVersion: true },
        });

        await tx.member.create({
          data: {
            id: randomUUID(),
            organizationId: organization.id,
            userId: access.user.id,
            role: WORKSPACE_OWNER_ROLE,
            encryptedOrgKey: data.encryptedOrgKey,
            createdAt: now,
          },
        });

        await tx.project.create({
          data: {
            id: data.project.id,
            name: data.project.name.trim(),
            organizationId: organization.id,
            encryptedProjectKey: data.project.encryptedProjectKey,
            members: {
              create: {
                userId: access.user.id,
                role: PROJECT_ADMIN_ROLE,
                encryptedProjectKey: data.project.creatorEncryptedProjectKey,
              },
            },
          },
        });

        return organization;
      });
    } catch (error) {
      // A concurrent request may take the slug between the check and the insert; the unique
      // index is the real guard, and its 409 is the answer the caller should see.
      if (WorkspacesService.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'That workspace name is already being used; please try a different name',
        );
      }
      throw error;
    }
  }

  async updateWorkspace(access: Access, data: { name?: string }) {
    const workspaceId = this.requireWorkspace(access);

    if (!data.name || data.name.trim().length === 0) {
      throw new BadRequestException('Workspace name cannot be empty');
    }

    return this.prisma.organization.update({
      where: { id: workspaceId },
      data: {
        name: data.name.trim(),
      },
    });
  }

  async getWorkspaceMembers(access: Access, pagination: { page?: number; limit?: number } = {}) {
    const workspaceId = this.requireWorkspace(access);

    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(100, Math.max(20, pagination.limit || 20));
    const totalCount = await this.prisma.member.count({
      where: { organizationId: workspaceId },
    });

    const members = await this.prisma.member.findMany({
      where: { organizationId: workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Count project memberships per user in this organization
    const projectMemberships = await this.prisma.projectMember.groupBy({
      by: ['userId'],
      where: {
        project: { organizationId: workspaceId },
      },
      _count: {
        projectId: true,
      },
    });

    const projectCountsByUser = new Map<string, number>();
    for (const pm of projectMemberships) {
      projectCountsByUser.set(pm.userId, pm._count.projectId);
    }

    const totalProjectsCount = await this.prisma.project.count({
      where: { organizationId: workspaceId },
    });

    const mappedMembers = members.map((m) => {
      const isAdmin = isWorkspaceAdministrator(m.role);
      const assignedCount = isAdmin ? totalProjectsCount : projectCountsByUser.get(m.userId) || 0;

      return {
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: m.role,
        assignedProjectsCount: assignedCount,
        createdAt: m.createdAt,
      };
    });

    const seenUserIds = new Set<string>();
    const deduplicatedMembers = mappedMembers.filter((m) => {
      if (seenUserIds.has(m.userId)) return false;
      seenUserIds.add(m.userId);
      return true;
    });

    return {
      items: deduplicatedMembers,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
        hasNextPage: page * limit < totalCount,
        hasPrevPage: page > 1,
      },
    };
  }

  async inviteMember(
    access: Access,
    data: {
      email: string;
      role?: string | undefined;
      projectIds?: string[] | undefined;
    },
  ) {
    const workspaceId = this.requireWorkspace(access);
    const role = data.role ?? DEFAULT_INVITATION_ROLE;

    if (!isInvitationRole(role)) {
      throw new BadRequestException('An invitation may only grant the editor or viewer role');
    }

    const trimmedEmail = data.email.trim().toLowerCase();

    const existingMember = await this.prisma.member.findFirst({
      where: {
        organizationId: workspaceId,
        user: { email: trimmedEmail },
      },
      select: { id: true },
    });

    if (existingMember) {
      throw new BadRequestException('User is already a member of this workspace');
    }

    let validProjectIds: string[] = [];
    if (data.projectIds && Array.isArray(data.projectIds) && data.projectIds.length > 0) {
      const projects = await this.prisma.project.findMany({
        where: { id: { in: data.projectIds }, organizationId: workspaceId },
        select: { id: true },
      });
      validProjectIds = projects.map((p) => p.id);
    }

    // Purge any stale pending or expired invitations for this email in this workspace
    await this.prisma.invitation.deleteMany({
      where: {
        organizationId: workspaceId,
        email: trimmedEmail,
      },
    });

    const invitationId = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.prisma.invitation.create({
      data: {
        id: invitationId,
        organizationId: workspaceId,
        email: trimmedEmail,
        role,
        status: 'pending',
        inviterId: access.user.id,
        expiresAt,
        projectIds: validProjectIds,
      },
    });

    const frontendBase = this.configService.get('FRONTEND_URL', { infer: true });
    return {
      ...invitation,
      inviteUrl: `${frontendBase}/invite/${invitation.id}`,
    };
  }

  async getWorkspaceInvitations(access: Access) {
    const workspaceId = this.requireWorkspace(access);

    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId: workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const frontendBase = this.configService.get('FRONTEND_URL', { infer: true });
    const now = new Date();

    return invitations.map((inv) => {
      return {
        id: inv.id,
        email: inv.email,
        role: invitationRoleOrDefault(inv.role),
        status: invitationStatus(inv, now),
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        inviterName: inv.user?.name || inv.user?.email || 'Admin',
        inviteUrl: `${frontendBase}/invite/${inv.id}`,
      };
    });
  }

  async revokeInvitation(access: Access, invitationId: string) {
    const workspaceId = this.requireWorkspace(access);

    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId: workspaceId },
      select: { id: true },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'revoked' },
    });

    return { success: true, message: 'Invitation revoked successfully' };
  }

  async updateMemberRole(
    access: Access,
    memberId: string,
    newRole: string,
    encryptedOrgKey?: string,
  ) {
    const workspaceId = this.requireWorkspace(access);

    if (!isWorkspaceRole(newRole) || isWorkspaceOwner(newRole)) {
      throw new BadRequestException(
        `Invalid role: ${newRole}. Allowed roles are admin, editor, viewer`,
      );
    }

    const targetMember = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true, organizationId: true, role: true, userId: true, encryptedOrgKey: true },
    });

    if (!targetMember || targetMember.organizationId !== workspaceId) {
      throw new NotFoundException('Member not found in this workspace');
    }

    // Stepping down replaces the workspace key and takes the caller out of the page that did it, so
    // it is never a side effect of editing a list: someone else changes your role.
    if (targetMember.id === access.memberId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    // Only the Owner may change an Owner; the rule table owns that decision, not this service.
    if (!canActOnMember(access.workspaceRole, targetMember.role)) {
      throw new ForbiddenException('You may not change this member');
    }

    // An admin needs the workspace key, and only the promoting member can wrap it. Accepting a
    // promotion without one leaves the new admin unable to open anything (audit C2).
    const promoting = isWorkspaceAdminRole(newRole);
    if (promoting && !encryptedOrgKey && !targetMember.encryptedOrgKey) {
      throw new BadRequestException(
        'Promoting a member to admin requires their wrapped workspace key',
      );
    }

    let wrappedVersions: number[] | null = null;
    if (promoting && encryptedOrgKey) {
      wrappedVersions = readWrappedKeyVersions(encryptedOrgKey, 1);
      if (!wrappedVersions) {
        throw new BadRequestException(
          'The wrapped workspace key must be a v1 wrap with a key version',
        );
      }
    }

    // A demoted admin must not keep the workspace key (audit E1). Rotating the workspace key so
    // the removed key is useless is batch 13c.
    const demoting = isWorkspaceAdminRole(targetMember.role) && !isWorkspaceAdminRole(newRole);

    const result = await this.prisma.$transaction(async (tx) => {
      // Promoting a member to Admin racing a rotation must not leave an Admin holding an old-version key:
      // take the organization row FOR SHARE and require the supplied encryptedOrgKey header version to equal
      // the current Organization.keyVersion.
      if (promoting && encryptedOrgKey && wrappedVersions) {
        await tx.$queryRaw`SELECT id FROM organization WHERE id = ${workspaceId} FOR SHARE`;
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: workspaceId },
          select: { keyVersion: true },
        });
        if (wrappedVersions[0] !== organization.keyVersion) {
          throw this.staleRotation();
        }
      }

      let rotationDue: string[] = [];
      if (demoting) {
        rotationDue = await this.markRotationDue(
          tx,
          workspaceId,
          targetMember.userId,
          targetMember.role,
        );
      }

      // The role and the key are one statement: there is no moment where one is set and the other is not.
      const updated = await tx.member.update({
        where: { id: memberId },
        data: {
          role: newRole,
          ...(promoting && encryptedOrgKey ? { encryptedOrgKey } : {}),
          ...(demoting ? { encryptedOrgKey: null } : {}),
        },
        select: { id: true, organizationId: true, userId: true, role: true, encryptedOrgKey: true },
      });

      return { ...updated, rotationDue };
    });

    if (targetMember.role !== newRole) {
      await this.notifications.roleChanged({
        userId: targetMember.userId,
        workspaceId,
        role: newRole,
      });
    }
    return result;
  }

  async removeMember(access: Access, memberId: string) {
    const workspaceId = this.requireWorkspace(access);

    const targetMember = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        organizationId: true,
        role: true,
        userId: true,
        user: { select: { id: true, email: true } },
      },
    });

    if (!targetMember || targetMember.organizationId !== workspaceId) {
      throw new NotFoundException('Member not found in this workspace');
    }

    // Admins may not remove an Owner, and nobody may remove the sole Owner (the rule table
    // states both), so a workspace is never left without one.
    if (!canActOnMember(access.workspaceRole, targetMember.role)) {
      throw new ForbiddenException('You may not remove this member');
    }

    const rotationDue = await this.prisma.$transaction((tx) =>
      this.revokeMembership(tx, workspaceId, targetMember.userId, targetMember.user?.email),
    );

    await this.notifications.removedFromWorkspace({ userId: targetMember.userId, workspaceId });
    return { ...targetMember, rotationDue };
  }

  /**
   * The only way an Owner changes. Call it inside a transaction.
   *
   * The old Owner is demoted first and the target promoted second, so the partial unique index
   * never sees two owners, even for a moment. The target must already hold the workspace key:
   * an Owner without it could not open the workspace.
   */
  async transferOwnership(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    fromUserId: string,
    toMemberId: string,
  ) {
    const [from, target] = await Promise.all([
      tx.member.findUnique({
        where: { organizationId_userId: { organizationId: workspaceId, userId: fromUserId } },
        select: { id: true, role: true },
      }),
      tx.member.findUnique({
        where: { id: toMemberId },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          role: true,
          encryptedOrgKey: true,
        },
      }),
    ]);

    if (!from || !isWorkspaceOwner(from.role)) {
      throw new ForbiddenException('Only the workspace owner can transfer ownership');
    }

    if (!target || target.organizationId !== workspaceId) {
      throw new NotFoundException('Member not found in this workspace');
    }

    if (target.userId === fromUserId) {
      throw new BadRequestException('You already own this workspace');
    }

    if (!target.encryptedOrgKey) {
      throw new BadRequestException(
        'The selected member does not hold the workspace key; promote them to admin first',
      );
    }

    await tx.member.update({ where: { id: from.id }, data: { role: WORKSPACE_ADMIN_ROLE } });
    await tx.member.update({ where: { id: target.id }, data: { role: WORKSPACE_OWNER_ROLE } });

    return tx.member.findUniqueOrThrow({
      where: { id: target.id },
      select: { id: true, organizationId: true, userId: true, role: true, encryptedOrgKey: true },
    });
  }

  async transferWorkspaceOwnership(access: Access, memberId: string) {
    const workspaceId = this.requireWorkspace(access);

    return this.prisma.$transaction((tx) =>
      this.transferOwnership(tx, workspaceId, access.user.id, memberId),
    );
  }

  /**
   * Removes everything that gives a person access to a workspace: their project grants and
   * wrapped keys, their membership (which holds the workspace key for admins), and any
   * invitation to their email. Content that belongs to others stays. Always call it inside
   * the transaction that makes the removal, so access is never half-revoked.
   */
  async revokeMembership(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
    email?: string | null,
  ): Promise<string[]> {
    const membership = await tx.member.findUnique({
      where: { organizationId_userId: { organizationId: workspaceId, userId } },
      select: { role: true },
    });
    const rotationDue = await this.markRotationDue(
      tx,
      workspaceId,
      userId,
      membership?.role ?? null,
    );

    await tx.projectMember.deleteMany({
      where: { userId, project: { organizationId: workspaceId } },
    });
    if (email) {
      await tx.invitation.deleteMany({
        where: { organizationId: workspaceId, email: email.toLowerCase().trim() },
      });
    }
    await tx.member.deleteMany({ where: { organizationId: workspaceId, userId } });

    return rotationDue;
  }

  /**
   * Marks every project whose key the departing person could open. An Admin or Owner knew every
   * project key in the workspace; anyone else only the projects they held a grant on.
   * Always called inside the removal transaction; returns the project ids for the response.
   */
  async markRotationDue(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
    role: string | null,
  ): Promise<string[]> {
    let projectIds: string[];

    if (isWorkspaceAdministrator(role)) {
      await tx.organization.update({
        where: { id: workspaceId },
        data: { keyRotationDue: true },
      });
      const projects = await tx.project.findMany({
        where: { organizationId: workspaceId },
        select: { id: true },
      });
      projectIds = projects.map((project) => project.id);
    } else {
      const grants = await tx.projectMember.findMany({
        where: { userId, project: { organizationId: workspaceId } },
        select: { projectId: true },
      });
      projectIds = grants.map((grant) => grant.projectId);
    }

    if (projectIds.length > 0) {
      await tx.project.updateMany({
        where: { id: { in: projectIds }, organizationId: workspaceId },
        data: { keyRotationDue: true },
      });
    }

    return projectIds;
  }

  async getInvitation(inviteId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: inviteId },
      select: {
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        organization: {
          select: { name: true },
        },
        user: {
          select: { name: true },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('This invitation link is not valid or has expired');
    }

    return {
      organization: {
        name: invitation.organization.name,
      },
      role: invitation.role,
      inviterName: invitation.user.name,
      status: invitationStatus(invitation),
      emailHint: maskEmail(invitation.email),
    };
  }

  /**
   * Whether the signed-in account is the one the invitation was sent to. The invitee's page asks
   * this before anything else, so the wrong account is stopped before it sets up a passphrase.
   */
  async isInvitationRecipient(access: Access, inviteId: string): Promise<{ isRecipient: boolean }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: inviteId },
      select: { email: true },
    });
    if (!invitation) {
      throw new NotFoundException('This invitation link is not valid or has expired');
    }
    return { isRecipient: isSameEmail(access.user.email, invitation.email) };
  }

  async acceptInvitation(access: Access, inviteId: string) {
    const userId = access.user.id;
    const result = await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { id: inviteId },
        include: { organization: true },
      });

      if (!invitation) {
        throw new NotFoundException('This invitation link is not valid or has expired');
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user || !isSameEmail(user.email, invitation.email)) {
        throw new ForbiddenException('This invitation was sent to a different email address');
      }

      const status = invitationStatus(invitation);

      if (status === 'accepted') {
        return {
          success: true,
          alreadyAccepted: true,
          workspaceSlug: invitation.organization.slug || invitation.organization.id,
          pendingProjectGrants: 0,
        };
      }

      if (status === 'expired') {
        throw new BadRequestException('This invitation has expired');
      }

      if (status === 'revoked') {
        throw new BadRequestException('This invitation is no longer valid');
      }

      const now = new Date();
      const claim = await tx.invitation.updateMany({
        where: {
          id: inviteId,
          status: 'pending',
          expiresAt: { gt: now },
        },
        data: { status: 'accepted' },
      });

      if (claim.count === 0) {
        const refreshed = await tx.invitation.findUnique({
          where: { id: inviteId },
          select: { status: true, expiresAt: true },
        });
        if (refreshed && invitationStatus(refreshed) === 'accepted') {
          return {
            success: true,
            alreadyAccepted: true,
            workspaceSlug: invitation.organization.slug || invitation.organization.id,
            pendingProjectGrants: 0,
          };
        }
        if (refreshed && invitationStatus(refreshed) === 'expired') {
          throw new BadRequestException('This invitation has expired');
        }
        throw new BadRequestException('This invitation is no longer valid');
      }

      // Invitations only ever grant Editor or Viewer; neither role holds the workspace key.
      const existingMember = await tx.member.findFirst({
        where: {
          organizationId: invitation.organizationId,
          userId,
        },
        select: { id: true },
      });

      if (!existingMember) {
        await tx.member.create({
          data: {
            id: randomUUID(),
            organizationId: invitation.organizationId,
            userId,
            role: invitationRoleOrDefault(invitation.role),
            createdAt: now,
          },
        });
      }

      // Pre-assigned projects start as pending grants: the row exists, but the key does not until
      // somebody who holds it wraps it for this user.
      let pendingProjectGrants = 0;
      if (invitation.projectIds.length > 0) {
        const existingProjects = await tx.project.findMany({
          where: {
            id: { in: invitation.projectIds },
            organizationId: invitation.organizationId,
          },
          select: { id: true },
        });
        const validProjectIds = Array.from(new Set(existingProjects.map((p) => p.id)));

        if (validProjectIds.length > 0) {
          const projectRole = projectRoleForInvitation(invitation.role);
          await tx.projectMember.createMany({
            data: validProjectIds.map((projectId) => ({
              projectId,
              userId,
              role: projectRole,
              encryptedProjectKey: null,
            })),
            skipDuplicates: true,
          });

          pendingProjectGrants = await tx.projectMember.count({
            where: {
              userId,
              projectId: { in: validProjectIds },
              encryptedProjectKey: null,
            },
          });
        }
      }

      return {
        success: true,
        workspaceSlug: invitation.organization.slug || invitation.organization.id,
        organizationId: invitation.organizationId,
        pendingProjectGrants,
      };
    });

    // Only the acceptance that did the work tells the administrators; a repeated accept does not.
    if (!('alreadyAccepted' in result)) {
      await this.notifications.invitationAccepted({
        workspaceId: result.organizationId,
        personId: userId,
        projectsWaiting: result.pendingProjectGrants,
      });
    }
    return result;
  }

  /**
   * Deletes a workspace inside the caller's transaction. Projects, boards, grants, members and
   * invitations go with it through the database cascade; the stored objects are queued and
   * deleted after the transaction commits.
   */
  async deleteWorkspaceWithin(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    const boards = await tx.board.findMany({
      where: { project: { organizationId: workspaceId }, hasPayload: true },
      select: { id: true, keyVersion: true },
    });
    const files = await tx.boardFile.findMany({
      where: { board: { project: { organizationId: workspaceId } } },
      select: { boardId: true, fileId: true, keyVersion: true },
    });
    const objectKeys = [
      ...boards.map((board) => `boards/${board.id}/v${board.keyVersion}.bin`),
      ...files.map((file) => `boards/${file.boardId}/v${file.keyVersion}/files/${file.fileId}.bin`),
    ];
    await this.blobPurge.enqueue(tx, objectKeys);
    await tx.organization.delete({ where: { id: workspaceId } });
  }

  async deleteWorkspace(access: Access) {
    const workspaceId = this.requireWorkspace(access);

    await this.prisma.$transaction((tx) => this.deleteWorkspaceWithin(tx, workspaceId));

    return {
      success: true,
      message: 'Workspace and all associated projects and boards deleted successfully',
    };
  }

  private slugBase(name: string): string {
    const latin = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      // The line above leaves no two dashes in a row, so at most one dash can sit at either end.
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .replace(/-$/g, '');

    // A name with no usable Latin characters still needs a unique, readable slug.
    return latin.length > 0 ? latin : `workspace-${randomBytes(3).toString('hex')}`;
  }

  private static isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }

  private async uniqueSlug(tx: Prisma.TransactionClient, base: string): Promise<string> {
    // One query decides the slug; the random suffixes prevent collisions.
    const candidates = [
      base,
      ...Array.from({ length: 5 }, () => `${base}-${randomBytes(2).toString('hex')}`),
    ];
    const existing = await tx.organization.findMany({
      where: { slug: { in: candidates } },
      select: { slug: true },
    });
    const taken = new Set(existing.map((row) => row.slug));
    const free = candidates.find((candidate) => !taken.has(candidate));
    if (!free) {
      throw new ConflictException('Could not allocate a unique workspace slug');
    }
    return free;
  }

  async getRotationPlan(access: Access) {
    this.requireWorkspaceAdministrator(access);
    const workspaceId = this.requireWorkspace(access);

    const organization = await this.prisma.organization.findUnique({
      where: { id: workspaceId },
      select: { keyVersion: true },
    });
    if (!organization) {
      throw new NotFoundException('Workspace not found');
    }

    const members = await this.prisma.member.findMany({
      where: {
        organizationId: workspaceId,
        role: { in: [...WORKSPACE_ADMINISTRATOR_ROLES] },
      },
      select: {
        userId: true,
        user: { select: { publicKey: true } },
      },
      orderBy: { userId: 'asc' },
    });

    const projects = await this.prisma.project.findMany({
      where: { organizationId: workspaceId },
      select: {
        id: true,
        keyVersion: true,
        encryptedProjectKey: true,
      },
      orderBy: { id: 'asc' },
    });

    return {
      keyVersion: organization.keyVersion,
      holders: members.map((m) => ({
        userId: m.userId,
        publicKey: m.user.publicKey,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        keyVersion: p.keyVersion,
        encryptedProjectKey: p.encryptedProjectKey,
      })),
    };
  }

  /**
   * The boards still encrypted under an older project key than their project's current one,
   * oldest first. The work is derived from the data, so any administrator can pick it up where
   * another stopped. A board with an active public link keeps its key (its link carries it), so
   * it is counted but never queued.
   */
  async getRekeyQueue(access: Access) {
    this.requireWorkspaceAdministrator(access);
    const workspaceId = this.requireWorkspace(access);

    const boards = await this.prisma.$queryRaw<RekeyQueueBoard[]>`
      SELECT b."id" AS "boardId", b."projectId", b."keyVersion",
             p."keyVersion" AS "projectKeyVersion", b."revision"
      FROM "board" b
      JOIN "project" p ON p."id" = b."projectId"
      WHERE p."organizationId" = ${workspaceId}
        AND b."hasPayload"
        AND b."keyVersion" < p."keyVersion"
        AND NOT (b."isPublic" AND b."publicShareToken" IS NOT NULL)
      ORDER BY b."updatedAt" ASC
      LIMIT ${REKEY_QUEUE_PAGE_SIZE}`;

    const [{ count: skippedPublic }] = await this.prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int AS "count"
      FROM "board" b
      JOIN "project" p ON p."id" = b."projectId"
      WHERE p."organizationId" = ${workspaceId}
        AND b."hasPayload"
        AND b."keyVersion" < p."keyVersion"
        AND b."isPublic" AND b."publicShareToken" IS NOT NULL`;

    return { boards, skippedPublic };
  }

  async rotateWorkspaceKey(
    access: Access,
    data: {
      expectedVersion: number;
      encryptedOrgKeys: Array<{ userId: string; encryptedOrgKey: string }>;
      projects: Array<{ id: string; projectKeyVersion: number; encryptedProjectKey: string }>;
    },
  ) {
    this.requireWorkspaceAdministrator(access);
    const workspaceId = this.requireWorkspace(access);

    return this.prisma.$transaction(async (tx) => {
      // Lock organization row first
      await tx.$queryRaw`SELECT id FROM organization WHERE id = ${workspaceId} FOR UPDATE`;
      const organization = await tx.organization.findUnique({
        where: { id: workspaceId },
        select: { keyVersion: true },
      });
      if (!organization) {
        throw new NotFoundException('Workspace not found');
      }
      if (organization.keyVersion !== data.expectedVersion) {
        throw this.staleRotation();
      }

      // Lock every project row in id order and read the versions from the locked rows: a project
      // rotation that committed a moment ago is seen, and none can start until this commits.
      const projectRows = await tx.$queryRaw<Array<{ id: string; keyVersion: number }>>`
        SELECT id, "keyVersion" FROM project
        WHERE "organizationId" = ${workspaceId}
        ORDER BY id ASC
        FOR UPDATE`;

      const newVersion = organization.keyVersion + 1;

      // 1. Holder validation: exactly current Owner/Admin members
      const currentHolders = await tx.member.findMany({
        where: {
          organizationId: workspaceId,
          role: { in: [...WORKSPACE_ADMINISTRATOR_ROLES] },
        },
        select: { userId: true },
      });
      const currentHolderIds = new Set(currentHolders.map((h) => h.userId));
      const suppliedHolderIds = new Set(data.encryptedOrgKeys.map((k) => k.userId));

      const missingHolders = [...currentHolderIds].filter((id) => !suppliedHolderIds.has(id));
      const extraHolders = [...suppliedHolderIds].filter((id) => !currentHolderIds.has(id));
      if (missingHolders.length > 0 || extraHolders.length > 0) {
        throw new BadRequestException({
          message: 'The rotation must cover exactly the current workspace administrators',
          missingUserIds: missingHolders,
          extraUserIds: extraHolders,
        });
      }

      // Check each wrapped org key header has [newVersion]
      for (const k of data.encryptedOrgKeys) {
        const versions = readWrappedKeyVersions(k.encryptedOrgKey, 1);
        if (!versions || versions[0] !== newVersion) {
          throw new BadRequestException(
            `The wrapped workspace key for ${k.userId} is not version ${newVersion}`,
          );
        }
      }

      // 2. Project coverage validation: exactly the workspace's projects
      const currentProjectMap = new Map(projectRows.map((p) => [p.id, p.keyVersion]));
      const currentProjectIds = new Set(currentProjectMap.keys());
      const suppliedProjectIds = new Set(data.projects.map((p) => p.id));

      const missingProjectIds = [...currentProjectIds].filter((id) => !suppliedProjectIds.has(id));
      const extraProjectIds = [...suppliedProjectIds].filter((id) => !currentProjectIds.has(id));
      if (missingProjectIds.length > 0 || extraProjectIds.length > 0) {
        throw new BadRequestException({
          message: 'The rotation must cover exactly the workspace projects',
          missingProjectIds,
          extraProjectIds,
        });
      }

      // Check each project entry: header has [projectKeyVersion, newVersion] where projectKeyVersion equals project's current keyVersion
      for (const p of data.projects) {
        const currentProjectVersion = currentProjectMap.get(p.id);
        if (p.projectKeyVersion !== currentProjectVersion) {
          throw this.staleRotation();
        }
        const versions = readWrappedKeyVersions(p.encryptedProjectKey, 2);
        if (!versions || versions[0] !== currentProjectVersion || versions[1] !== newVersion) {
          throw new BadRequestException(
            `Project ${p.id} must be wrapped as version ${currentProjectVersion} under workspace version ${newVersion}`,
          );
        }
      }

      // 3. Write new version and clear Organization.keyRotationDue (project keyRotationDue flags stay set)
      const switched = await tx.organization.updateMany({
        where: { id: workspaceId, keyVersion: data.expectedVersion },
        data: {
          keyVersion: newVersion,
          keyRotationDue: false,
        },
      });
      if (switched.count === 0) {
        throw this.staleRotation();
      }

      await Promise.all(
        data.encryptedOrgKeys.map((k) =>
          tx.member.updateMany({
            where: { organizationId: workspaceId, userId: k.userId },
            data: { encryptedOrgKey: k.encryptedOrgKey },
          }),
        ),
      );

      await Promise.all(
        data.projects.map((p) =>
          tx.project.updateMany({
            where: { id: p.id, organizationId: workspaceId },
            data: { encryptedProjectKey: p.encryptedProjectKey },
          }),
        ),
      );

      return { keyVersion: newVersion };
    });
  }

  private staleRotation(): ConflictException {
    return new ConflictException({
      code: 'STALE_KEY_VERSION',
      message: 'The workspace key changed since this rotation started. Reload and try again.',
    });
  }

  private requireWorkspaceAdministrator(access: Access): void {
    if (!isWorkspaceAdministrator(access.workspaceRole)) {
      throw new ForbiddenException('Only workspace owners and admins can rotate a workspace key');
    }
  }

  private requireWorkspace(access: Access): string {
    if (!access.workspace) {
      throw new ForbiddenException('An active workspace is required');
    }
    return access.workspace.id;
  }
}
