import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { Public } from '../access/decorators.js';

@Public()
@Controller(['api/health', 'healthz'])
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async getHealth(@Res() res: Response) {
    let dbStatus = 'up';
    let storageStatus = 'up';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'down';
    }

    try {
      const isStorageHealthy = await this.storage.checkHealth();
      if (!isStorageHealthy) {
        storageStatus = 'down';
      }
    } catch {
      storageStatus = 'down';
    }

    const isHealthy = dbStatus === 'up' && storageStatus === 'up';
    const statusCode = isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    return res.status(statusCode).json({
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: dbStatus,
        storage: storageStatus,
      },
    });
  }
}
