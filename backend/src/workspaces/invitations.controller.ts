import { Controller, Get, Post, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WorkspacesService } from './workspaces.service.js';
import { Access, CurrentAccess, Public } from '../access/decorators.js';
import type { Access as AccessContext } from '../access/access.types.js';

@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get(':id')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async getInvitation(@Param('id') id: string) {
    return this.workspacesService.getInvitation(id);
  }

  @Get(':id/recipient')
  @Access({ scope: 'session' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async isInvitationRecipient(@CurrentAccess() access: AccessContext, @Param('id') id: string) {
    return this.workspacesService.isInvitationRecipient(access, id);
  }

  @Post(':id/accept')
  @Access({ scope: 'session' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async acceptInvitation(@CurrentAccess() access: AccessContext, @Param('id') id: string) {
    return this.workspacesService.acceptInvitation(access, id);
  }
}
