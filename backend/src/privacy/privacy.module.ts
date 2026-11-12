import { Module } from '@nestjs/common';
import { DataCleanupService } from './data-cleanup.service.js';

@Module({
  controllers: [],
  providers: [DataCleanupService],
  exports: [DataCleanupService],
})
export class PrivacyModule {}
