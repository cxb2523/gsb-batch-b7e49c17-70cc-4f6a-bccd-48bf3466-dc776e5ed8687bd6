import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import {
  CreateProjectDto,
  UpdateProjectDto,
  AddProjectMemberDto,
  UpdateProjectMemberRoleDto,
} from './dto/project.dto.js';
import { RotateProjectKeyDto } from './dto/rotation.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { Access, CurrentAccess } from '../access/decorators.js';
import type { Access as AccessContext } from '../access/access.types.js';

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Access({ scope: 'workspace', can: ['create', 'Project'] })
  async create(@CurrentAccess() access: AccessContext, @Body() body: CreateProjectDto) {
    return this.projectsService.create(
      access,
      body.id,
      body.name,
      body.encryptedProjectKey,
      body.creatorEncryptedProjectKey,
    );
  }

  @Get()
  @Access({ scope: 'workspace' })
  async findAll(@CurrentAccess() access: AccessContext, @Query() query: PaginationQueryDto) {
    return this.projectsService.findAll(access, query);
  }

  @Patch(':id')
  @Access({ scope: 'project', can: ['update', 'Project'] })
  async update(@CurrentAccess() access: AccessContext, @Body() body: UpdateProjectDto) {
    return this.projectsService.update(access, body.name);
  }

  @Delete(':id')
  @Access({ scope: 'project', can: ['delete', 'Project'] })
  async delete(@CurrentAccess() access: AccessContext) {
    return this.projectsService.delete(access);
  }

  @Get(':id/rotation-plan')
  @Access({ scope: 'project' })
  async rotationPlan(@CurrentAccess() access: AccessContext) {
    return this.projectsService.getRotationPlan(access);
  }

  @Post(':id/rotate-key')
  @HttpCode(200)
  @Access({ scope: 'project' })
  async rotateKey(@CurrentAccess() access: AccessContext, @Body() body: RotateProjectKeyDto) {
    return this.projectsService.rotateProjectKey(access, body);
  }

  @Get(':id/key-history')
  @Access({ scope: 'project', can: ['read', 'Project'] })
  async keyHistory(@CurrentAccess() access: AccessContext) {
    return this.projectsService.getKeyHistory(access);
  }

  @Get(':id/members')
  @Access({ scope: 'project', can: ['read', 'ProjectMember'] })
  async getMembers(@CurrentAccess() access: AccessContext, @Query() query: PaginationQueryDto) {
    return this.projectsService.getProjectMembers(access, query);
  }

  @Get(':id/assignable-members')
  @Access({ scope: 'project', can: ['manage', 'ProjectMember'] })
  async getAssignableMembers(
    @CurrentAccess() access: AccessContext,
    @Query() query: PaginationQueryDto,
  ) {
    return this.projectsService.getAssignableMembers(access, query);
  }

  @Post(':id/members')
  @Access({ scope: 'project', can: ['manage', 'ProjectMember'] })
  async addMember(@CurrentAccess() access: AccessContext, @Body() body: AddProjectMemberDto) {
    return this.projectsService.addProjectMember(
      access,
      body.userId,
      body.role,
      body.encryptedProjectKey,
    );
  }

  @Patch(':id/members/:userId')
  @Access({ scope: 'project', can: ['manage', 'ProjectMember'] })
  async updateMemberRole(
    @CurrentAccess() access: AccessContext,
    @Param('userId') userId: string,
    @Body() body: UpdateProjectMemberRoleDto,
  ) {
    return this.projectsService.updateProjectMemberRole(access, userId, body.role);
  }

  @Delete(':id/members/:userId')
  @Access({ scope: 'project', can: ['manage', 'ProjectMember'] })
  async removeMember(@CurrentAccess() access: AccessContext, @Param('userId') userId: string) {
    return this.projectsService.removeProjectMember(access, userId);
  }
}
