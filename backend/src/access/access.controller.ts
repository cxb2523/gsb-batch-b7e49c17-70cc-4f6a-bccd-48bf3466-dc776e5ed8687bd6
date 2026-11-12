import { Controller, Get, Query } from '@nestjs/common';
import { AccessService } from './access.service.js';
import { Access, CurrentUser } from './decorators.js';
import type { AccessUser } from './access.types.js';

@Controller('api/access')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  /**
   * The caller's own rules. Batch 15 consumes this so the UI can stop carrying a second copy of
   * the rule table. It exposes only the caller's roles; no other person's role or key is read.
   */
  @Get('me')
  @Access({ scope: 'session' })
  async me(@CurrentUser() user: AccessUser, @Query('workspace') workspace?: string) {
    return this.accessService.describeAccess(user, workspace);
  }
}
