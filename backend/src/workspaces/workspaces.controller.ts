import { Controller, Get, Patch, Post, Delete, Body, Param, Query, HttpCode } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service.js';
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
  TransferOwnershipDto,
} from './dto/workspace.dto.js';
import { RotateWorkspaceKeyDto } from './dto/rotation.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { Access, CurrentAccess } from '../access/decorators.js';
import type { Access as AccessContext } from '../access/access.types.js';

@Controller('api/workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @Access({ scope: 'session' })
  async createWorkspace(@CurrentAccess() access: AccessContext, @Body() body: CreateWorkspaceDto) {
    return this.workspacesService.createWorkspace(access, body);
  }

  @Get(':slugOrId')
  @Access({ scope: 'workspace', param: 'slugOrId', can: ['read', 'Workspace'] })
  async getWorkspace(@CurrentAccess() access: AccessContext) {
    return this.workspacesService.getWorkspace(access);
  }

  @Patch(':id')
  @Access({ scope: 'workspace', can: ['update', 'Workspace'] })
  async updateWorkspace(@CurrentAccess() access: AccessContext, @Body() body: UpdateWorkspaceDto) {
    return this.workspacesService.updateWorkspace(access, body);
  }

  @Get(':id/members')
  @Access({ scope: 'workspace', can: ['read', 'Member'] })
  async getWorkspaceMembers(
    @CurrentAccess() access: AccessContext,
    @Query() query: PaginationQueryDto,
  ) {
    // The query schema always supplies page and limit, so this route is never unbounded.
    return this.workspacesService.getWorkspaceMembers(access, {
      page: query.page,
      limit: query.limit,
    });
  }

  @Post(':id/transfer-ownership')
  @Access({ scope: 'workspace', can: ['transfer', 'Workspace'] })
  async transferOwnership(
    @CurrentAccess() access: AccessContext,
    @Body() body: TransferOwnershipDto,
  ) {
    return this.workspacesService.transferWorkspaceOwnership(access, body.memberId);
  }

  @Post(':id/members/invite')
  @Access({ scope: 'workspace', can: ['create', 'Invitation'] })
  async inviteMember(@CurrentAccess() access: AccessContext, @Body() body: InviteMemberDto) {
    return this.workspacesService.inviteMember(access, body);
  }

  @Get(':id/invitations')
  @Access({ scope: 'workspace', can: ['read', 'Invitation'] })
  async getWorkspaceInvitations(@CurrentAccess() access: AccessContext) {
    return this.workspacesService.getWorkspaceInvitations(access);
  }

  @Delete(':id/invitations/:invitationId')
  @Access({ scope: 'workspace', can: ['delete', 'Invitation'] })
  async revokeInvitation(
    @CurrentAccess() access: AccessContext,
    @Param('invitationId') invitationId: string,
  ) {
    return this.workspacesService.revokeInvitation(access, invitationId);
  }

  @Patch(':id/members/:memberId')
  @Access({ scope: 'workspace', can: ['update', 'Member'] })
  async updateMemberRole(
    @CurrentAccess() access: AccessContext,
    @Param('memberId') memberId: string,
    @Body() body: UpdateMemberRoleDto,
  ) {
    return this.workspacesService.updateMemberRole(
      access,
      memberId,
      body.role,
      body.encryptedOrgKey,
    );
  }

  @Delete(':id/members/:memberId')
  @Access({ scope: 'workspace', can: ['delete', 'Member'] })
  async removeMember(@CurrentAccess() access: AccessContext, @Param('memberId') memberId: string) {
    return this.workspacesService.removeMember(access, memberId);
  }

  @Delete(':id')
  @Access({ scope: 'workspace', can: ['delete', 'Workspace'] })
  async deleteWorkspace(@CurrentAccess() access: AccessContext) {
    return this.workspacesService.deleteWorkspace(access);
  }

  @Get(':id/rotation-plan')
  @Access({ scope: 'workspace', can: ['update', 'Workspace'] })
  async rotationPlan(@CurrentAccess() access: AccessContext) {
    return this.workspacesService.getRotationPlan(access);
  }

  @Get(':id/rekey-queue')
  @Access({ scope: 'workspace', can: ['update', 'Workspace'] })
  async rekeyQueue(@CurrentAccess() access: AccessContext) {
    return this.workspacesService.getRekeyQueue(access);
  }

  @Post(':id/rotate-key')
  @HttpCode(200)
  @Access({ scope: 'workspace', can: ['update', 'Workspace'] })
  async rotateKey(@CurrentAccess() access: AccessContext, @Body() body: RotateWorkspaceKeyDto) {
    return this.workspacesService.rotateWorkspaceKey(access, body);
  }
}
