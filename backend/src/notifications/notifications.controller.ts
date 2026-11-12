import { Controller, Get, Param, Post, Query, Sse } from '@nestjs/common';
import { Access, CurrentUser } from '../access/decorators.js';
import type { AccessUser } from '../access/access.types.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { NotificationsService } from './notifications.service.js';

/** Every route is the caller's own inbox; nobody reads another person's. */
@Controller('api/notifications')
@Access({ scope: 'session' })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: AccessUser, @Query() query: PaginationQueryDto) {
    return this.notificationsService.list(user.id, { page: query.page, limit: query.limit });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AccessUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Sse('stream')
  stream(@CurrentUser() user: AccessUser) {
    return this.notificationsService.streamFor(user.id);
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: AccessUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Post(':id/read')
  async markRead(@CurrentUser() user: AccessUser, @Param('id') id: string) {
    return this.notificationsService.markRead(user.id, id);
  }
}
