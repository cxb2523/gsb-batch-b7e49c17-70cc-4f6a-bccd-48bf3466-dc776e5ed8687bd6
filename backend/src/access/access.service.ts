import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EnvConfig } from '../config/env.schema.js';
import { packRules } from '@casl/ability/extra';
import { defineAbilityFor } from './abilities.js';
import {
  isProjectRole,
  isWorkspaceAdministrator,
  isWorkspaceRole,
  type ProjectRole,
  type WorkspaceRole,
} from './roles.js';
import type { Access, AccessUser } from './access.types.js';
import type { AccessRequirement } from './decorators.js';
import { canCreateWorkspace } from './workspace-creation.js';

/** The bits of the Express request that access resolution needs. */
export interface AccessRequest {
  user?: AccessUser;
  session?: { activeOrganizationId?: string | null } | null;
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}

interface MemberRow {
  id: string;
  role: string;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Resolves a request's access exactly once: the workspace, the caller's membership, the project
 * and project grant when the route has one, and the ability derived from the rule table.
 *
 * A caller who is not a member of the resolved workspace is refused with 403 here, before any
 * handler runs. That is also what makes a stranger's `active-organization` header a 403 instead
 * of the 500 it used to produce.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async resolve(requirement: AccessRequirement, request: AccessRequest): Promise<Access> {
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    switch (requirement.scope) {
      case 'session':
        return this.forSession(user);
      case 'workspace':
        return this.forWorkspace(user, request, requirement);
      case 'project':
        return this.forProject(user, request, requirement);
      case 'board':
        return this.forBoard(user, request, requirement);
      default:
        throw new ForbiddenException('This route has no access scope');
    }
  }

  private forSession(user: AccessUser): Access {
    return {
      user,
      workspace: null,
      workspaceRole: null,
      memberId: null,
      project: null,
      projectRole: null,
      boardId: null,
      ability: defineAbilityFor({ workspaceRole: null, projectRole: null }),
    };
  }

  private async forWorkspace(
    user: AccessUser,
    request: AccessRequest,
    requirement: AccessRequirement,
  ): Promise<Access> {
    const reference =
      request.params?.[requirement.param ?? 'id'] ??
      firstHeader(request.headers['active-organization']) ??
      request.session?.activeOrganizationId ??
      undefined;

    if (!reference) {
      throw new BadRequestException('An active workspace is required for this request');
    }

    return this.resolveWorkspaceForUser(user, reference);
  }

  /**
   * Resolves a workspace reference without a request scope. Used by `GET /api/access/me`, where
   * the workspace is a query parameter rather than an `@Access` scope.
   */
  async resolveWorkspaceForUser(user: AccessUser, reference: string): Promise<Access> {
    // An id must never be shadowed by a slug that happens to equal it. Ids are generated and
    // slugs are chosen by clients, so the unambiguous lookup order is id first, slug second.
    const workspace =
      (await this.prisma.organization.findUnique({
        where: { id: reference },
        select: { id: true, slug: true },
      })) ??
      (await this.prisma.organization.findUnique({
        where: { slug: reference },
        select: { id: true, slug: true },
      }));

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const member = await this.loadMember(workspace.id, user.id);
    const workspaceRole = this.requireWorkspaceRole(member);

    return {
      user,
      workspace,
      workspaceRole,
      memberId: member.id,
      project: null,
      projectRole: null,
      boardId: null,
      ability: defineAbilityFor({ workspaceRole, projectRole: null }),
    };
  }

  /**
   * The body of `GET /api/access/me`: the caller's creation right, and — when a workspace is
   * named — the packed rule sets the UI should use for that workspace. Packed rules are the
   * library's own wire format, so the frontend can unpack them with the same CASL version.
   */
  async describeAccess(user: AccessUser, workspaceReference?: string) {
    const memberships = await this.prisma.member.findMany({
      where: { userId: user.id },
      select: { role: true },
    });

    const limit = this.configService.get('LIMIT_WORKSPACES_PER_ACCOUNT', { infer: true });
    const canCreate = canCreateWorkspace(memberships, limit);

    if (!workspaceReference) {
      return { canCreateWorkspace: canCreate };
    }

    const access = await this.resolveWorkspaceForUser(user, workspaceReference);
    const workspaceId = access.workspace?.id ?? '';
    const workspaceRole = access.workspaceRole;

    const projectMemberships = await this.prisma.projectMember.findMany({
      where: { userId: user.id, project: { organizationId: workspaceId } },
      select: { projectId: true, role: true },
    });

    const projectRoles: Record<string, ProjectRole> = {};
    for (const membership of projectMemberships) {
      if (isProjectRole(membership.role)) {
        projectRoles[membership.projectId] = membership.role;
      }
    }

    const projectRulesFor = (projectRole: ProjectRole) =>
      packRules(
        defineAbilityFor({
          workspaceRole,
          projectRole,
          isAssignedToProject: true,
        }).rules,
      );

    return {
      canCreateWorkspace: canCreate,
      workspace: access.workspace,
      workspaceRole,
      isWorkspaceAdministrator: isWorkspaceAdministrator(workspaceRole),
      rules: packRules(access.ability.rules),
      projectRules: {
        admin: projectRulesFor('admin'),
        editor: projectRulesFor('editor'),
        viewer: projectRulesFor('viewer'),
      },
      projectRoles,
    };
  }

  private async forProject(
    user: AccessUser,
    request: AccessRequest,
    requirement: AccessRequirement,
  ): Promise<Access> {
    const projectId = this.resourceId(request, requirement);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        organizationId: true,
        organization: { select: { slug: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return this.forProjectRow(user, {
      projectId: project.id,
      organizationId: project.organizationId,
      organizationSlug: project.organization.slug,
    });
  }

  private async forBoard(
    user: AccessUser,
    request: AccessRequest,
    requirement: AccessRequirement,
  ): Promise<Access> {
    const boardId = this.resourceId(request, requirement);
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: {
        id: true,
        projectId: true,
        project: {
          select: {
            organizationId: true,
            organization: { select: { slug: true } },
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundException('Board not found');
    }

    const access = await this.forProjectRow(user, {
      projectId: board.projectId,
      organizationId: board.project.organizationId,
      organizationSlug: board.project.organization.slug,
    });
    return { ...access, boardId: board.id };
  }

  private async forProjectRow(
    user: AccessUser,
    project: { projectId: string; organizationId: string; organizationSlug: string | null },
  ): Promise<Access> {
    const member = await this.loadMember(project.organizationId, user.id);
    const workspaceRole = this.requireWorkspaceRole(member);

    let projectRole: ProjectRole | null = null;
    if (isWorkspaceAdministrator(workspaceRole)) {
      projectRole = 'admin';
    } else {
      const grant = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.projectId, userId: user.id } },
        select: { role: true },
      });
      if (grant && isProjectRole(grant.role)) {
        projectRole = grant.role;
      }
    }

    const ability = defineAbilityFor({
      workspaceRole,
      projectRole,
      isAssignedToProject: projectRole !== null,
    });

    return {
      user,
      workspace: { id: project.organizationId, slug: project.organizationSlug },
      workspaceRole,
      memberId: member.id,
      project: { id: project.projectId },
      projectRole,
      boardId: null,
      ability,
    };
  }

  private async loadMember(organizationId: string, userId: string): Promise<MemberRow> {
    const member = await this.prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, role: true },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    return member;
  }

  private requireWorkspaceRole(member: MemberRow): WorkspaceRole {
    if (!isWorkspaceRole(member.role)) {
      throw new ForbiddenException('Your workspace role is not recognised');
    }
    return member.role;
  }

  private resourceId(request: AccessRequest, requirement: AccessRequirement): string {
    const param = requirement.param ?? 'id';
    const value = requirement.from === 'body' ? request.body?.[param] : request.params?.[param];

    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException(`Missing '${param}' for this request`);
    }

    return value;
  }
}
