import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DiscoveryModule } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { AccessModule } from './access/access.module.js';
import { AccessGuard, SessionGuard } from './access/access.guard.js';
import { ProjectsModule } from './projects/projects.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { BoardsModule } from './boards/boards.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { StaticAssetsModule } from './static/static-assets.module.js';
import { validateEnv, type EnvConfig } from './config/env.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    DiscoveryModule,
    PrismaModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => {
        const ttlSeconds = configService.get('RATE_LIMIT_TTL', { infer: true });
        const configuredLimit = configService.get('RATE_LIMIT_LIMIT', { infer: true });
        const rateLimitEnabled = configService.get('RATE_LIMIT_ENABLED', { infer: true });

        return [
          {
            name: 'default',
            ttl: ttlSeconds * 1000,
            limit: !rateLimitEnabled ? 100000 : configuredLimit,
            skipIf: () => !rateLimitEnabled,
          },
        ];
      },
    }),
    AuthModule,
    AccessModule,
    UsersModule,
    NotificationsModule,
    WorkspacesModule,
    ProjectsModule,
    BoardsModule,
    StorageModule,
    PrivacyModule,
    StaticAssetsModule.forRootAsync(),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SessionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AccessGuard,
    },
  ],
})
export class AppModule {}
