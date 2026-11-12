import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { BlobPurgeService } from './blob-purge.service.js';

@Module({
  imports: [StorageModule],
  providers: [BlobPurgeService],
  exports: [BlobPurgeService],
})
export class MaintenanceModule {}
