import { describe, it, expect, vi } from 'vitest';
import { HealthController } from '../src/health/health.controller.js';

describe('HealthController (GET /api/health)', () => {
  it('returns 200 OK when database and storage are up', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '1': 1 }]),
    };
    const mockStorage = {
      checkHealth: vi.fn().mockResolvedValue(true),
    };

    const controller = new HealthController(mockPrisma as any, mockStorage as any);

    let responseStatus = 0;
    let responseBody: any = null;
    const mockRes = {
      status: vi.fn((code: number) => {
        responseStatus = code;
        return {
          json: (body: any) => {
            responseBody = body;
            return body;
          },
        };
      }),
    };

    await controller.getHealth(mockRes as any);

    expect(responseStatus).toBe(200);
    expect(responseBody.status).toBe('ok');
    expect(responseBody.services.database).toBe('up');
    expect(responseBody.services.storage).toBe('up');
    expect(typeof responseBody.uptime).toBe('number');
    expect(responseBody.timestamp).toBeDefined();
  });

  it('returns 503 Service Unavailable when database query fails', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('Connection lost')),
    };
    const mockStorage = {
      checkHealth: vi.fn().mockResolvedValue(true),
    };

    const controller = new HealthController(mockPrisma as any, mockStorage as any);

    let responseStatus = 0;
    let responseBody: any = null;
    const mockRes = {
      status: vi.fn((code: number) => {
        responseStatus = code;
        return {
          json: (body: any) => {
            responseBody = body;
            return body;
          },
        };
      }),
    };

    await controller.getHealth(mockRes as any);

    expect(responseStatus).toBe(503);
    expect(responseBody.status).toBe('degraded');
    expect(responseBody.services.database).toBe('down');
    expect(responseBody.services.storage).toBe('up');
  });

  it('returns 503 Service Unavailable when storage check fails', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '1': 1 }]),
    };
    const mockStorage = {
      checkHealth: vi.fn().mockResolvedValue(false),
    };

    const controller = new HealthController(mockPrisma as any, mockStorage as any);

    let responseStatus = 0;
    let responseBody: any = null;
    const mockRes = {
      status: vi.fn((code: number) => {
        responseStatus = code;
        return {
          json: (body: any) => {
            responseBody = body;
            return body;
          },
        };
      }),
    };

    await controller.getHealth(mockRes as any);

    expect(responseStatus).toBe(503);
    expect(responseBody.status).toBe('degraded');
    expect(responseBody.services.database).toBe('up');
    expect(responseBody.services.storage).toBe('down');
  });

  it('supports dual routes (/api/health and healthz) on the controller', () => {
    const metadata = Reflect.getMetadata('path', HealthController);
    expect(metadata).toEqual(['api/health', 'healthz']);
  });
});
