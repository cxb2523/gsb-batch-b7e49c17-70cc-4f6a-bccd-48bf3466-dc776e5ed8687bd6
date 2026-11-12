import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlobPurgeService } from '../maintenance/blob-purge.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  isProjectRole,
  isWorkspaceAdministrator,
  PROJECT_ADMIN_ROLE,
  WORKSPACE_ADMINISTRATOR_ROLES,
} from '../access/roles.js';
import type { Access } from '../access/access.types.js';
import { readWrappedKeyVersions } from '../common/dto/wrapped-key.schema.js';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blobPurge: BlobPurgeService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    access: Access,
    id: string,
    name: string,
    encryptedProjectKey: string,
    creatorEncryptedProjectKey: string,
  ) {
    const organizationId = this.requireWorkspace(access);

    const workspaceWrap = readWrappedKeyVersions(encryptedProjectKey, 2);
    if (!workspaceWrap || workspaceWrap[0] !== 1) {
      throw new BadRequestException('A new project key must be a v1 wrap of project version 1');
    }

    return this.prisma.$transaction(async (tx) => {
      // A shared lock keeps a workspace key rotation (exclusive) from committing between this
      // check and the insert, so no project is stored under a retired workspace key.
      await tx.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR SHARE`;
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { keyVersion: true },
      });
      if (workspaceWrap[1] !== organization.keyVersion) {
        throw new ConflictException({
          code: 'STALE_KEY_VERSION',
          message: 'The workspace key changed since this key was wrapped. Reload and try again.',
        });
      }

      return tx.project.create({
        data: {
          id,
          name,
          organizationId,
          encryptedProjectKey,
          members: {
            create: {
              userId: access.user.id,
              role: PROJECT_ADMIN_ROLE,
              encryptedProjectKey: creatorEncryptedProjectKey,
            },
          },
        },
        include: {
          members: true,
        },
      });
    });
  }

  async findAll(access: Access, pagination?: { page?: number; limit?: number }) {
    const organizationId = this.requireWorkspace(access);
    const seesEverything = isWorkspaceAdministrator(access.workspaceRole);

    const where: {
      organizationId: string;
      members?: { some: { userId: string } };
    } = { organizationId };

    if (!seesEverything) {
      where.members = { some: { userId: access.user.id } };
    }

    const include = {
      _count: {
        select: { boards: true, members: true },
      },
      members: {
        where: { userId: access.user.id },
        select: { id: true, userId: true, role: true, encryptedProjectKey: true },
      },
    };

    if (pagination) {
      const page = Math.max(1, pagination.page || 1);
      const limit = Math.max(20, pagination.limit || 20);
      const total = await this.prisma.project.count({ where });
      const items = await this.prisma.project.findMany({
        where,
        include,
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      });

      return {
        items: items.map((project) => this.withKeyStatus(project, seesEverything)),
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

    const projects = await this.prisma.project.findMany({
      where,
      include,
      orderBy: { id: 'asc' },
    });

    return projects.map((project) => this.withKeyStatus(project, seesEverything));
  }

  /** Whether this caller can open the project's boards, without exposing the wrapped key. */
  private withKeyStatus<T extends { members: Array<{ encryptedProjectKey: string | null }> }>(
    project: T,
    seesEverything: boolean,
  ): T & { keyStatus: 'granted' | 'pending' } {
    const granted = seesEverything || Boolean(project.members[0]?.encryptedProjectKey);
    return { ...project, keyStatus: granted ? 'granted' : 'pending' };
  }

  async findOne(access: Access) {
    const projectId = this.requireProject(access);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        organizationId: true,
        encryptedProjectKey: true,
        members: {
          where: { userId: access.user.id },
          select: { userId: true, role: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    return project;
  }

  async update(access: Access, name: string) {
    const projectId = this.requireProject(access);

    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Project name cannot be empty');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: { name: name.trim() },
    });
  }

  async delete(access: Access) {
    const projectId = this.requireProject(access);

    // The project's boards and grants are removed by the database cascade; the stored
    // objects are queued in the same transaction and deleted after it commits.
    return this.prisma.$transaction(async (tx) => {
      const boards = await tx.board.findMany({
        where: { projectId, hasPayload: true },
        select: { id: true, keyVersion: true },
      });
      const files = await tx.boardFile.findMany({
        where: { board: { projectId } },
        select: { boardId: true, fileId: true, keyVersion: true },
      });
      const objectKeys = [
        ...boards.map((board) => `boards/${board.id}/v${board.keyVersion}.bin`),
        ...files.map(
          (file) => `boards/${file.boardId}/v${file.keyVersion}/files/${file.fileId}.bin`,
        ),
      ];
      await this.blobPurge.enqueue(tx, objectKeys);
      return tx.project.delete({ where: { id: projectId } });
    });
  }

  async getProjectMembers(
    access: Access,
    pagination: { page?: number | undefined; limit?: number | undefined } = {},
  ) {
    const projectId = this.requireProject(access);
    const organizationId = this.requireWorkspace(access);

    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(100, Math.max(20, pagination.limit || 20));

    // Owners and admins can open every project through the workspace key, so they are members in
    // effect even without an explicit grant. They are shown once, from the workspace side.
    const workspaceAdministrators = await this.prisma.member.findMany({
      where: { organizationId, role: { in: [...WORKSPACE_ADMINISTRATOR_ROLES] } },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const administratorIds = workspaceAdministrators.map((member) => member.userId);

    const explicitWhere = {
      projectId,
      ...(administratorIds.length > 0 ? { userId: { notIn: administratorIds } } : {}),
    };
    const explicitTotal = await this.prisma.projectMember.count({ where: explicitWhere });
    const total = workspaceAdministrators.length + explicitTotal;
    const skip = (page - 1) * limit;

    type EffectiveMember = {
      id: string;
      userId: string;
      name: string;
      email: string;
      image: string | null;
      role: string;
      source: 'workspace' | 'project';
      keyStatus: 'granted' | 'pending';
      createdAt: Date;
    };

    const items: EffectiveMember[] = [];
    if (skip < workspaceAdministrators.length) {
      for (const member of workspaceAdministrators.slice(skip, skip + limit)) {
        items.push({
          id: member.id,
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          image: member.user.image,
          role: 'admin',
          source: 'workspace',
          keyStatus: 'granted',
          createdAt: member.createdAt,
        });
      }
    }

    const remaining = limit - items.length;
    if (remaining > 0) {
      const grants = await this.prisma.projectMember.findMany({
        where: explicitWhere,
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: Math.max(0, skip - workspaceAdministrators.length),
        take: remaining,
      });

      for (const grant of grants) {
        items.push({
          id: grant.id,
          userId: grant.userId,
          name: grant.user.name,
          email: grant.user.email,
          image: grant.user.image,
          role: grant.role,
          source: 'project',
          keyStatus: grant.encryptedProjectKey ? 'granted' : 'pending',
          createdAt: grant.createdAt,
        });
      }
    }

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

  /**
   * Workspace members who could still be given this project: everyone without a grant (pending
   * ones included) except owners and admins, who open every project already. It is the picker
   * behind "Assign member", served to whoever may manage the project's members, because a
   * Project Admin who is only an Editor in the workspace cannot read the workspace member list.
   */
  async getAssignableMembers(
    access: Access,
    pagination: { page?: number | undefined; limit?: number | undefined } = {},
  ) {
    const projectId = this.requireProject(access);
    const organizationId = this.requireWorkspace(access);

    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(100, Math.max(20, pagination.limit || 20));
    const where = {
      organizationId,
      role: { notIn: [...WORKSPACE_ADMINISTRATOR_ROLES] },
      user: { projectMembers: { none: { projectId } } },
    };

    const [total, members] = await Promise.all([
      this.prisma.member.count({ where }),
      this.prisma.member.findMany({
        where,
        select: { userId: true, user: { select: { name: true, email: true } } },
        orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: members.map((member) => ({
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
      })),
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

  async addProjectMember(
    access: Access,
    userId: string,
    role: string,
    encryptedProjectKey: string,
  ) {
    const projectId = this.requireProject(access);
    const organizationId = this.requireWorkspace(access);
    const projectRole = this.requireProjectRole(role);

    const wrappedVersions = readWrappedKeyVersions(encryptedProjectKey, 1);
    if (!wrappedVersions) {
      throw new BadRequestException('The project key must be a v1 wrap with a key version');
    }

    const member = await this.prisma.$transaction(async (tx) => {
      // A shared lock on the project row keeps a rotation (which locks it exclusively) from
      // committing between this version check and the write, so no grant is stored under an
      // old project key.
      await tx.$queryRaw`SELECT id FROM project WHERE id = ${projectId} FOR SHARE`;
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { keyVersion: true },
      });
      if (wrappedVersions[0] !== project.keyVersion) {
        throw this.staleRotation();
      }

      // Verify the target is a member of the workspace.
      const orgMembership = await tx.member.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { id: true },
      });

      if (!orgMembership) {
        throw new BadRequestException('User is not a member of the workspace');
      }

      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { id: true, encryptedProjectKey: true },
      });

      if (!existing) {
        return tx.projectMember.create({
          data: {
            projectId,
            userId,
            role: projectRole,
            encryptedProjectKey,
          },
        });
      }

      // Adding somebody who already has a grant is a conflict: changing their role is the existing
      // role-change route, which touches the role only. The single allowed write here is filling a
      // missing key once; a key that is already set is never replaced by this route.
      if (existing.encryptedProjectKey === null) {
        const filled = await tx.projectMember.updateMany({
          where: { id: existing.id, encryptedProjectKey: null },
          data: { encryptedProjectKey },
        });

        if (filled.count === 1) {
          return tx.projectMember.findUniqueOrThrow({ where: { id: existing.id } });
        }
      }

      throw new ConflictException('This user already has access to the project');
    });

    if (userId !== access.user.id) {
      await this.notifications.accessGranted({ userId, workspaceId: organizationId, projectId });
    }
    return member;
  }

  async updateProjectMemberRole(access: Access, userId: string, role: string) {
    const projectId = this.requireProject(access);
    const projectRole = this.requireProjectRole(role);

    const existing = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId, userId },
      },
      select: { id: true, role: true },
    });

    if (!existing) {
      throw new NotFoundException('User is not assigned to this project');
    }

    const updated = await this.prisma.projectMember.update({
      where: {
        projectId_userId: { projectId, userId },
      },
      data: { role: projectRole },
    });

    if (existing.role !== projectRole && userId !== access.user.id) {
      await this.notifications.projectRoleChanged({
        userId,
        workspaceId: this.requireWorkspace(access),
        projectId,
        role: projectRole,
      });
    }
    return updated;
  }

  async removeProjectMember(access: Access, userId: string) {
    const projectId = this.requireProject(access);

    const existing = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId, userId },
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('User is not assigned to this project');
    }

    const removed = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.projectMember.delete({
        where: {
          projectId_userId: { projectId, userId },
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { keyRotationDue: true },
      });
      return { ...deleted, rotationDue: [projectId] };
    });

    if (userId !== access.user.id) {
      await this.notifications.removedFromProject({
        userId,
        workspaceId: this.requireWorkspace(access),
        projectId,
      });
    }
    return removed;
  }

  /**
   * What an Owner or Admin needs to rotate one project: the current version and every granted
   * person's public key. Pending grants are excluded and stay pending.
   */
  async getRotationPlan(access: Access) {
    this.requireWorkspaceAdministrator(access);
    const projectId = this.requireProject(access);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { keyVersion: true, keyRotationDue: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const grants = await this.prisma.projectMember.findMany({
      where: { projectId, encryptedProjectKey: { not: null } },
      select: { userId: true, user: { select: { publicKey: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return {
      keyVersion: project.keyVersion,
      keyRotationDue: project.keyRotationDue,
      grants: grants.map((grant) => ({
        userId: grant.userId,
        publicKey: grant.user.publicKey,
      })),
    };
  }

  /** The chain entries a reader needs to walk an older project key forward to the current one. */
  async getKeyHistory(access: Access) {
    const projectId = this.requireProject(access);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { keyVersion: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const entries = await this.prisma.projectKeyHistory.findMany({
      where: { projectId },
      orderBy: { version: 'asc' },
      select: { version: true, encryptedKey: true, createdAt: true },
    });

    return {
      keyVersion: project.keyVersion,
      entries: entries.map((entry) => ({
        oldVersion: entry.version,
        newVersion: entry.version + 1,
        encryptedKey: entry.encryptedKey,
        createdAt: entry.createdAt,
      })),
    };
  }

  /**
   * Replaces one project key generation in a single transaction. The caller supplies every wrapped
   * copy; the server checks the declared versions and the exact granted-person set, then writes
   * the project key, every grant, the history entry and the version together.
   */
  async rotateProjectKey(
    access: Access,
    data: {
      expectedVersion: number;
      encryptedProjectKey: string;
      historyEntry: string;
      grants: Array<{ userId: string; encryptedProjectKey: string }>;
    },
  ) {
    this.requireWorkspaceAdministrator(access);
    const projectId = this.requireProject(access);
    const organizationId = this.requireWorkspace(access);

    return this.prisma.$transaction(async (tx) => {
      // Exclusive lock: grants being added wait for this rotation, and the granted set read below
      // cannot change until it commits.
      await tx.$queryRaw`SELECT id FROM project WHERE id = ${projectId} FOR UPDATE`;
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { organizationId: true, keyVersion: true },
      });
      if (!project || project.organizationId !== organizationId) {
        throw new NotFoundException('Project not found');
      }
      if (project.keyVersion !== data.expectedVersion) {
        throw this.staleRotation();
      }

      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { keyVersion: true, keyRotationDue: true },
      });
      if (!organization) {
        throw new NotFoundException('Workspace not found');
      }
      if (organization.keyRotationDue) {
        throw new ConflictException({
          code: 'WORKSPACE_ROTATION_PENDING',
          message: 'The workspace key is pending rotation; rotate the workspace key first.',
        });
      }

      const newVersion = project.keyVersion + 1;
      const projectKeyVersions = readWrappedKeyVersions(data.encryptedProjectKey, 2);
      if (
        !projectKeyVersions ||
        projectKeyVersions[0] !== newVersion ||
        projectKeyVersions[1] !== organization.keyVersion
      ) {
        throw new BadRequestException(
          'The new project key must be a v1 wrap of version ' +
            `${newVersion} under workspace version ${organization.keyVersion}`,
        );
      }

      const historyVersions = readWrappedKeyVersions(data.historyEntry, 2);
      if (
        !historyVersions ||
        historyVersions[0] !== project.keyVersion ||
        historyVersions[1] !== newVersion
      ) {
        throw new BadRequestException(
          'The history entry must wrap the old project key under the new one',
        );
      }

      const currentGrants = await tx.projectMember.findMany({
        where: { projectId, encryptedProjectKey: { not: null } },
        select: { userId: true },
      });
      const currentIds = new Set(currentGrants.map((grant) => grant.userId));
      const suppliedIds = new Set<string>();
      for (const grant of data.grants) {
        suppliedIds.add(grant.userId);
        const versions = readWrappedKeyVersions(grant.encryptedProjectKey, 1);
        if (!versions || versions[0] !== newVersion) {
          throw new BadRequestException(
            `The wrapped project key for ${grant.userId} is not version ${newVersion}`,
          );
        }
      }

      const missing = [...currentIds].filter((id) => !suppliedIds.has(id));
      const extra = [...suppliedIds].filter((id) => !currentIds.has(id));
      if (missing.length > 0 || extra.length > 0) {
        throw new BadRequestException({
          message: 'The rotation must cover exactly the currently granted people',
          missingUserIds: missing,
          extraUserIds: extra,
        });
      }

      // The guarded switch is the race winner: a concurrent rotation sees 0 here and changes
      // nothing else in its transaction.
      const switched = await tx.project.updateMany({
        where: { id: projectId, keyVersion: data.expectedVersion },
        data: {
          encryptedProjectKey: data.encryptedProjectKey,
          keyVersion: newVersion,
          keyRotationDue: false,
        },
      });
      if (switched.count === 0) {
        throw this.staleRotation();
      }

      const updateResults = await Promise.all(
        data.grants.map((grant) =>
          tx.projectMember.updateMany({
            where: { projectId, userId: grant.userId, encryptedProjectKey: { not: null } },
            data: { encryptedProjectKey: grant.encryptedProjectKey },
          }),
        ),
      );
      if (updateResults.some((res) => res.count !== 1)) {
        throw new ConflictException('The granted people changed during rotation; try again');
      }

      await tx.projectKeyHistory.create({
        data: {
          projectId,
          version: data.expectedVersion,
          encryptedKey: data.historyEntry,
        },
      });

      return { keyVersion: newVersion };
    });
  }

  private staleRotation(): ConflictException {
    return new ConflictException({
      code: 'STALE_KEY_VERSION',
      message: 'The project key changed since this rotation started. Reload and try again.',
    });
  }

  private requireWorkspaceAdministrator(access: Access): void {
    if (!isWorkspaceAdministrator(access.workspaceRole)) {
      throw new ForbiddenException('Only workspace owners and admins can rotate a project key');
    }
  }

  private requireWorkspace(access: Access): string {
    if (!access.workspace) {
      throw new ForbiddenException('An active workspace is required');
    }
    return access.workspace.id;
  }

  private requireProject(access: Access): string {
    if (!access.project) {
      throw new ForbiddenException('A project is required');
    }
    return access.project.id;
  }

  private requireProjectRole(role: string): string {
    if (!isProjectRole(role)) {
      throw new BadRequestException(`Invalid project role: ${role}`);
    }
    return role;
  }
}
