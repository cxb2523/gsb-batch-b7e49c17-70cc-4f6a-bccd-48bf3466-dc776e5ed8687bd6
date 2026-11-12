import { Module } from '@nestjs/common';
import { BoardsController } from './boards.controller.js';
import { PublicBoardsController } from './public-boards.controller.js';
import { BoardsService } from './boards.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';

@Module({
  imports: [StorageModule, MaintenanceModule],
  controllers: [BoardsController, PublicBoardsController],
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
