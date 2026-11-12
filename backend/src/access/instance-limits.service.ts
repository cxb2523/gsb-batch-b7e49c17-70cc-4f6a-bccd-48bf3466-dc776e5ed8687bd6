import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { EnvConfig } from '../config/env.schema.js';

export type LimitKind = 'workspaces' | 'boards' | 'storage' | 'signups';

export interface LimitReachedErrorBody {
  code: 'LIMIT_REACHED';
  limit: LimitKind;
  message: string;
}

@Injectable()
export class InstanceLimitsService {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  /**
   * Enforces LIMIT_WORKSPACES_PER_ACCOUNT for the given user.
   * Workspaces are counted as memberships where role = 'owner'.
   */
  async checkWorkspaceLimit(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const limit = this.configService.get('LIMIT_WORKSPACES_PER_ACCOUNT', { infer: true });
    if (limit === undefined) return;

    const ownedCount = await tx.member.count({
      where: {
        userId,
        role: 'owner',
      },
    });

    if (ownedCount >= limit) {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        limit: 'workspaces',
        message: `This instance allows ${limit} workspace${limit === 1 ? '' : 's'} per account. Ask the instance operator to raise the limit.`,
      });
    }
  }

  /**
   * Enforces LIMIT_BOARDS_PER_ACCOUNT.
   * Boards are counted across all workspaces owned by the workspace's owner.
   */
  async checkBoardLimit(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    const limit = this.configService.get('LIMIT_BOARDS_PER_ACCOUNT', { infer: true });
    if (limit === undefined) return;

    const owner = await tx.member.findFirst({
      where: { organizationId, role: 'owner' },
      select: { userId: true },
    });
    if (!owner) return;

    const totalBoards = await tx.board.count({
      where: {
        project: {
          organization: {
            members: {
              some: {
                userId: owner.userId,
                role: 'owner',
              },
            },
          },
        },
      },
    });

    if (totalBoards >= limit) {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        limit: 'boards',
        message: `This instance allows ${limit} board${limit === 1 ? '' : 's'} per account. Ask the instance operator to raise the limit.`,
      });
    }
  }

  /**
   * Enforces LIMIT_STORAGE_MB_PER_ACCOUNT.
   * Total storage = payloadBytes on board + SUM(BoardFile.size) across all workspaces owned by the workspace's owner.
   * A save or write that shrinks the board or keeps it unchanged (deltaBytes <= 0) is always allowed.
   */
  async checkStorageLimit(
    tx: Prisma.TransactionClient,
    organizationId: string,
    deltaBytes: number,
  ): Promise<void> {
    if (deltaBytes <= 0) {
      return;
    }

    const limitMb = this.configService.get('LIMIT_STORAGE_MB_PER_ACCOUNT', { infer: true });
    if (limitMb === undefined) return;

    const owner = await tx.member.findFirst({
      where: { organizationId, role: 'owner' },
      select: { userId: true },
    });
    if (!owner) return;

    const limitBytes = limitMb * 1024 * 1024;

    const payloadAgg = await tx.board.aggregate({
      _sum: { payloadBytes: true },
      where: {
        project: {
          organization: {
            members: {
              some: {
                userId: owner.userId,
                role: 'owner',
              },
            },
          },
        },
      },
    });
    const totalPayloadBytes = payloadAgg['_sum'].payloadBytes ?? 0;

    const filesAgg = await tx.boardFile.aggregate({
      _sum: { size: true },
      where: {
        board: {
          project: {
            organization: {
              members: {
                some: {
                  userId: owner.userId,
                  role: 'owner',
                },
              },
            },
          },
        },
      },
    });
    const totalFileBytes = filesAgg['_sum'].size ?? 0;

    const currentTotal = totalPayloadBytes + totalFileBytes;
    if (currentTotal + deltaBytes > limitBytes) {
      throw new ForbiddenException({
        code: 'LIMIT_REACHED',
        limit: 'storage',
        message: `This instance allows ${limitMb} MB of storage per account. Ask the instance operator to raise the limit.`,
      });
    }
  }
}
