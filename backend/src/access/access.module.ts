import { Global, Module } from '@nestjs/common';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';
import { AccessGuard, SessionGuard } from './access.guard.js';
import { InstanceLimitsService } from './instance-limits.service.js';

/** Global so every controller and the APP_GUARD registrations can use it. */
@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessService, SessionGuard, AccessGuard, InstanceLimitsService],
  exports: [AccessService, InstanceLimitsService],
})
export class AccessModule {}
