import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvConfig } from '../config/env.schema.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService<EnvConfig, true>) {
    const connectionString = configService.get('DATABASE_URL', { infer: true });
    const poolSize = configService.get('DATABASE_POOL_SIZE', { infer: true });

    super({
      adapter: new PrismaPg({
        connectionString,
        max: poolSize,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
