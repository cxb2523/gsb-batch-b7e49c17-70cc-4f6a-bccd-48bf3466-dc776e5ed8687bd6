import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { EnvConfig } from '../config/env.schema.js';
import { InstanceLimitsService } from './instance-limits.service.js';

const MB = 1024 * 1024;

function isConfigService(val: unknown): val is ConfigService<EnvConfig, true> {
  return typeof val === 'object' && val !== null;
}

function isTransactionClient(val: unknown): val is Prisma.TransactionClient {
  return typeof val === 'object' && val !== null;
}

/** The refusal every limit throws: a 403 carrying the one `LIMIT_REACHED` body. */
function limitReached(limit: string, message: string) {
  return {
    status: 403,
    response: { code: 'LIMIT_REACHED', limit, message: expect.stringContaining(message) },
  };
}

describe('InstanceLimitsService', () => {
  const config = { get: vi.fn() };
  const db = {
    member: { count: vi.fn(), findFirst: vi.fn() },
    board: { count: vi.fn(), aggregate: vi.fn() },
    boardFile: { aggregate: vi.fn() },
  };
  let limits: InstanceLimitsService;

  function tx(): Prisma.TransactionClient {
    const candidate: unknown = db;
    if (!isTransactionClient(candidate)) throw new Error('invalid transaction stub');
    return candidate;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    const candidate: unknown = config;
    if (!isConfigService(candidate)) throw new Error('invalid config stub');
    limits = new InstanceLimitsService(candidate);
  });

  describe('checkWorkspaceLimit', () => {
    it('does nothing when the limit is unset', async () => {
      config.get.mockReturnValue(undefined);

      await expect(limits.checkWorkspaceLimit(tx(), 'u1')).resolves.toBeUndefined();
      expect(db.member.count).not.toHaveBeenCalled();
    });

    it('passes below the limit and counts only owned workspaces', async () => {
      config.get.mockReturnValue(3);
      db.member.count.mockResolvedValue(2);

      await expect(limits.checkWorkspaceLimit(tx(), 'u1')).resolves.toBeUndefined();
      expect(db.member.count).toHaveBeenCalledWith({ where: { userId: 'u1', role: 'owner' } });
    });

    it('refuses at the limit', async () => {
      config.get.mockReturnValue(3);
      db.member.count.mockResolvedValue(3);

      const refused = limits.checkWorkspaceLimit(tx(), 'u1');
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toMatchObject(
        limitReached('workspaces', 'This instance allows 3 workspaces per account'),
      );
    });
  });

  describe('checkBoardLimit', () => {
    it('does nothing when the limit is unset', async () => {
      config.get.mockReturnValue(undefined);

      await expect(limits.checkBoardLimit(tx(), 'org1')).resolves.toBeUndefined();
      expect(db.member.findFirst).not.toHaveBeenCalled();
    });

    it('passes below the limit and counts every board of the owner', async () => {
      config.get.mockReturnValue(5);
      db.member.findFirst.mockResolvedValue({ userId: 'owner-1' });
      db.board.count.mockResolvedValue(4);

      await expect(limits.checkBoardLimit(tx(), 'org1')).resolves.toBeUndefined();
      expect(db.board.count).toHaveBeenCalledWith({
        where: {
          project: {
            organization: { members: { some: { userId: 'owner-1', role: 'owner' } } },
          },
        },
      });
    });

    it('refuses at the limit', async () => {
      config.get.mockReturnValue(5);
      db.member.findFirst.mockResolvedValue({ userId: 'owner-1' });
      db.board.count.mockResolvedValue(5);

      await expect(limits.checkBoardLimit(tx(), 'org1')).rejects.toMatchObject(
        limitReached('boards', 'This instance allows 5 boards per account'),
      );
    });
  });

  describe('checkStorageLimit', () => {
    function storedAlready(payloadBytes: number, fileBytes: number) {
      db.member.findFirst.mockResolvedValue({ userId: 'owner-1' });
      db.board.aggregate.mockResolvedValue({ _sum: { payloadBytes } });
      db.boardFile.aggregate.mockResolvedValue({ _sum: { size: fileBytes } });
    }

    it('always allows a write that does not grow the total', async () => {
      config.get.mockReturnValue(10);

      await expect(limits.checkStorageLimit(tx(), 'org1', 0)).resolves.toBeUndefined();
      await expect(limits.checkStorageLimit(tx(), 'org1', -100)).resolves.toBeUndefined();
      expect(db.member.findFirst).not.toHaveBeenCalled();
    });

    it('does nothing when the limit is unset', async () => {
      config.get.mockReturnValue(undefined);

      await expect(limits.checkStorageLimit(tx(), 'org1', 500)).resolves.toBeUndefined();
      expect(db.member.findFirst).not.toHaveBeenCalled();
    });

    it('passes when the total after the write is within the limit', async () => {
      config.get.mockReturnValue(10);
      storedAlready(2 * MB, 3 * MB);

      await expect(limits.checkStorageLimit(tx(), 'org1', 5 * MB)).resolves.toBeUndefined();
    });

    it('refuses a write that takes the total past the limit', async () => {
      config.get.mockReturnValue(10);
      storedAlready(6 * MB, 4 * MB);

      await expect(limits.checkStorageLimit(tx(), 'org1', 1)).rejects.toMatchObject(
        limitReached('storage', 'This instance allows 10 MB of storage per account'),
      );
    });
  });
});
