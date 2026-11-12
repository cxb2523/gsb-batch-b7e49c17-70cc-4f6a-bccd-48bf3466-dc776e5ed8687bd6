import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AUTH, createAuth } from './auth.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EnvConfig } from '../config/env.schema.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH,
      inject: [ConfigService, PrismaService],
      useFactory: (configService: ConfigService<EnvConfig, true>, prisma: PrismaService) =>
        createAuth(configService, prisma),
    },
  ],
  exports: [AUTH],
})
export class AuthModule {}
