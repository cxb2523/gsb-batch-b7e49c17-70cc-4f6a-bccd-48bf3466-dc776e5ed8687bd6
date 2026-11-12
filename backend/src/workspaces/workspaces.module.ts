import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { InvitationsController } from './invitations.controller.js';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';

@Module({
  imports: [MaintenanceModule],
  controllers: [WorkspacesController, InvitationsController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
