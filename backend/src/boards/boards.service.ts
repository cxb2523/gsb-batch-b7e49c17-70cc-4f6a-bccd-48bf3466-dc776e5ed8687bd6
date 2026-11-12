import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { BlobPurgeService } from '../maintenance/blob-purge.service.js';
import { InstanceLimitsService } from '../access/instance-limits.service.js';
import type { Access } from '../access/access.types.js';
import { isWorkspaceAdministrator } from '../access/roles.js';
import { randomBytes } from 'crypto';
import { readWrappedKeyVersions } from '../common/dto/wrapped-key.schema.js';

/** A payload can be 15MB, so the locked save needs more than Prisma's 5 second default. */
const PAYLOAD_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_BOARD_STORAGE_BYTES = 50 * 1024 * 1024; // 50MB
const MIN_PAYLOAD_BYTES = 37; // 1 format + 4 keyVersion + 4 revision + 12 IV + 16 tag

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly blobPurge: BlobPurgeService,
    private readonly limitsService: InstanceLimitsService,
  ) {}

  async create(
    access: Access,
    id: string,
    title: string,
    encryptedBoardKey: string,
    projectKeyVersion: number,
  ) {
    const projectId = this.requireProject(access);
    this.validateTitle(title);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { keyVersion: true, organizationId: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    await this.limitsService.checkBoardLimit(this.prisma, project.organizationId);
    if (project.keyVersion !== projectKeyVersion) {
      throw new ConflictException({
        code: 'STALE_KEY_VERSION',
        message:
          'The project key has changed since this canvas key was wrapped. Reload the project and try again.',
      });
    }

    return this.prisma.board.create({
      data: {
        id,
        title: title.trim(),
        projectId,
        encryptedBoardKey,
        keyVersion: projectKeyVersion,
      },
    });
  }

  async findAll(
    access: Access,
    options: {
      projectId?: string;
      search?: string;
      pagination?: { page?: number; limit?: number };
      sort?: string;
    } = {},
  ) {
    const organizationId = this.requireWorkspace(access);
    const { projectId, search, pagination = {}, sort } = options;

    // Owners and admins hold the workspace key and see every project. Everyone else is scoped to
    // the projects they are assigned to.
    const seesEverything = isWorkspaceAdministrator(access.workspaceRole);

    if (projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { organizationId: true },
      });
      if (!project || project.organizationId !== organizationId) {
        throw new ForbiddenException('Project does not belong to active organization');
      }
      if (!seesEverything) {
        const grant = await this.prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: access.user.id } },
          select: { id: true },
        });
        if (!grant) {
          throw new ForbiddenException('You do not have access to this project');
        }
      }
    }

    const projectFilter = seesEverything
      ? { organizationId }
      : { organizationId, members: { some: { userId: access.user.id } } };

    const whereClause = projectId
      ? {
          projectId,
          ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
        }
      : {
          project: projectFilter,
          ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
        };

    const includeClause = projectId
      ? undefined
      : {
          project: {
            select: { id: true, name: true },
          },
        };

    const orderBy = this.getSortOrder(sort);

    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(100, Math.max(20, pagination.limit || 20));
    const total = await this.prisma.board.count({ where: whereClause });
    const items = await this.prisma.board.findMany({
      where: whereClause,
      ...(includeClause ? { include: includeClause } : {}),
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  private getSortOrder(sort?: string) {
    switch (sort) {
      case 'updated-asc':
        return { updatedAt: 'asc' as const };
      case 'created-desc':
        return { createdAt: 'desc' as const };
      case 'created-asc':
        return { createdAt: 'asc' as const };
      case 'title-asc':
        return { title: 'asc' as const };
      case 'title-desc':
        return { title: 'desc' as const };
      case 'updated-desc':
      default:
        return { updatedAt: 'desc' as const };
    }
  }

  async findOne(access: Access) {
    const boardId = this.requireBoard(access);
    const userId = access.user.id;

    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            encryptedProjectKey: true,
            keyVersion: true,
            members: {
              where: { userId },
              select: { id: true, userId: true, role: true, encryptedProjectKey: true },
            },
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundException(`Board with ID ${boardId} not found`);
    }

    return board;
  }

  async update(access: Access, data: { title?: string }) {
    const boardId = this.requireBoard(access);

    return this.prisma.board.update({
      where: { id: boardId },
      data: {
        ...(data.title ? { title: data.title } : {}),
      },
    });
  }

  async savePayload(
    access: Access,
    payloadBuffer: Buffer,
    clientRevision: number,
    encryptedBoardKey?: string,
    fileIds?: string[],
  ) {
    const boardId = this.requireBoard(access);

    if (payloadBuffer.length < MIN_PAYLOAD_BYTES || payloadBuffer[0] !== 0x01) {
      throw new BadRequestException(
        'Encrypted payload must use the v1 board-payload format (format byte 0x01)',
      );
    }
    const payloadVersion = payloadBuffer.readUInt32BE(1);
    const payloadRevision = payloadBuffer.readUInt32BE(5);

    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: {
        id: true,
        keyVersion: true,
        revision: true,
        isPublic: true,
        publicShareToken: true,
        project: { select: { keyVersion: true, organizationId: true } },
      },
    });
    if (!board) {
      throw new NotFoundException(`Board with ID ${boardId} not found`);
    }

    if (clientRevision !== board.revision) {
      throw new ConflictException({
        code: 'BOARD_CONFLICT',
        message: 'This canvas was modified elsewhere.',
        revision: board.revision,
      });
    }

    if (payloadRevision !== board.revision + 1) {
      throw new BadRequestException('The payload revision must equal current revision + 1');
    }

    const activeFiles = await this.prisma.boardFile.findMany({
      where: {
        boardId,
        ...(fileIds !== undefined ? { fileId: { in: fileIds } } : {}),
      },
      select: { size: true },
    });
    const totalFilesSize = activeFiles.reduce((acc, f) => acc + f.size, 0);
    if (totalFilesSize + payloadBuffer.length > MAX_BOARD_STORAGE_BYTES) {
      throw new PayloadTooLargeException('Board total storage exceeds 50MB limit');
    }

    const projectKeyVersion = board.project.keyVersion;
    const hasPublicLink = board.isPublic && Boolean(board.publicShareToken);

    if (
      payloadVersion === board.keyVersion &&
      (board.keyVersion === projectKeyVersion || hasPublicLink)
    ) {
      return this.storePayloadLocked(
        boardId,
        board.keyVersion,
        projectKeyVersion,
        clientRevision,
        payloadBuffer,
        undefined,
        fileIds,
        board.project.organizationId,
      );
    }

    const isRekey =
      payloadVersion === projectKeyVersion &&
      payloadVersion > board.keyVersion &&
      !hasPublicLink &&
      Boolean(encryptedBoardKey);

    if (!isRekey) {
      if (hasPublicLink && payloadVersion === projectKeyVersion) {
        throw new ConflictException({
          code: 'PUBLIC_BOARD_REKEY',
          message: 'A board with an active public link cannot be re-keyed.',
          boardKeyVersion: board.keyVersion,
          projectKeyVersion,
        });
      }
      throw this.keyRotated(board.keyVersion, projectKeyVersion);
    }

    if (!encryptedBoardKey) {
      throw this.keyRotated(board.keyVersion, projectKeyVersion);
    }

    const versions = readWrappedKeyVersions(encryptedBoardKey, 2);
    if (!versions || versions[0] !== payloadVersion || versions[1] !== payloadVersion) {
      throw new BadRequestException(
        'The re-keyed board key must be a v1 wrap at the payload version',
      );
    }

    return this.storePayloadLocked(
      boardId,
      board.keyVersion,
      projectKeyVersion,
      clientRevision,
      payloadBuffer,
      encryptedBoardKey,
      fileIds,
      board.project.organizationId,
    );
  }

  /**
   * Stores a payload and, for a re-key, switches the board to the new key version. The board row
   * is locked first, so two saves never interleave: the version is re-checked under the lock (a
   * save that lost the race gets KEY_ROTATED and changes nothing), and the object is written
   * before the row is updated, so a failed upload leaves the board on its old, readable version.
   * A re-key queues the old version's object for purge in the same transaction.
   */
  private storePayloadLocked(
    boardId: string,
    boardKeyVersion: number,
    projectKeyVersion: number,
    clientRevision: number,
    payloadBuffer: Buffer,
    rekeyedBoardKey?: string,
    fileIds?: string[],
    organizationId?: string,
  ) {
    const payloadVersion = payloadBuffer.readUInt32BE(1);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM board WHERE id = ${boardId} FOR UPDATE`;
        const latest = await tx.board.findUniqueOrThrow({
          where: { id: boardId },
          select: {
            keyVersion: true,
            revision: true,
            payloadBytes: true,
            project: { select: { organizationId: true } },
          },
        });
        if (latest.revision !== clientRevision) {
          throw new ConflictException({
            code: 'BOARD_CONFLICT',
            message: 'This canvas was modified elsewhere.',
            revision: latest.revision,
          });
        }
        if (latest.keyVersion !== boardKeyVersion) {
          throw this.keyRotated(latest.keyVersion, projectKeyVersion);
        }

        const orgId = organizationId ?? latest.project?.organizationId;
        if (orgId) {
          const deltaBytes = payloadBuffer.length - (latest.payloadBytes ?? 0);
          await this.limitsService.checkStorageLimit(tx, orgId, deltaBytes);
        }

        await this.storageService.uploadPayload(boardId, payloadVersion, payloadBuffer);

        if (fileIds !== undefined) {
          const filesToPrune = await tx.boardFile.findMany({
            where: {
              boardId,
              fileId: { notIn: fileIds },
            },
            select: { fileId: true, keyVersion: true },
          });
          if (filesToPrune.length > 0) {
            const fileKeys = filesToPrune.map((f) =>
              this.storageService.getBoardFileKey(boardId, f.keyVersion, f.fileId),
            );
            await this.blobPurge.enqueue(tx, fileKeys);
            await tx.boardFile.deleteMany({
              where: {
                boardId,
                fileId: { in: filesToPrune.map((f) => f.fileId) },
              },
            });
          }
        }

        if (rekeyedBoardKey === undefined) {
          return tx.board.update({
            where: { id: boardId },
            data: {
              hasPayload: true,
              payloadBytes: payloadBuffer.length,
              revision: latest.revision + 1,
              updatedAt: new Date(),
            },
            select: {
              id: true,
              hasPayload: true,
              revision: true,
              updatedAt: true,
            },
          });
        }

        const currentFiles = await tx.boardFile.findMany({
          where: { boardId },
          select: { fileId: true, keyVersion: true },
        });
        // Moving a row without its re-encrypted object would make the image unreadable for good.
        const copied = await Promise.all(
          currentFiles.map((file) =>
            this.storageService.hasFile(boardId, payloadVersion, file.fileId),
          ),
        );
        const missing = currentFiles.find((_, index) => !copied[index]);
        if (missing) {
          throw new BadRequestException(
            `File ${missing.fileId} must be re-encrypted at the new key version before a re-key`,
          );
        }
        const oldFileKeys = currentFiles.map((f) =>
          this.storageService.getBoardFileKey(boardId, f.keyVersion, f.fileId),
        );
        if (currentFiles.length > 0) {
          await tx.boardFile.updateMany({
            where: { boardId },
            data: { keyVersion: payloadVersion },
          });
        }
        const objectKeys = [
          this.storageService.getBoardPayloadKey(boardId, boardKeyVersion),
          ...oldFileKeys,
        ];
        await this.blobPurge.enqueue(tx, objectKeys);
        return tx.board.update({
          where: { id: boardId },
          data: {
            encryptedBoardKey: rekeyedBoardKey,
            keyVersion: payloadVersion,
            hasPayload: true,
            payloadBytes: payloadBuffer.length,
            revision: latest.revision + 1,
            updatedAt: new Date(),
          },
          select: {
            id: true,
            hasPayload: true,
            revision: true,
            updatedAt: true,
          },
        });
      },
      { timeout: PAYLOAD_TRANSACTION_TIMEOUT_MS },
    );
  }

  private keyRotated(boardKeyVersion: number, projectKeyVersion: number): ConflictException {
    return new ConflictException({
      code: 'KEY_ROTATED',
      message: 'The project key has rotated; re-seal this board and retry.',
      boardKeyVersion,
      projectKeyVersion,
    });
  }

  async getPayload(access: Access): Promise<{ buffer: Buffer; revision: number }> {
    const boardId = this.requireBoard(access);
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { hasPayload: true, keyVersion: true, revision: true },
    });

    if (!board?.hasPayload) {
      throw new NotFoundException('Board has no saved payload');
    }

    const payload = await this.storageService.getPayload(boardId, board.keyVersion);
    if (!payload) {
      throw new NotFoundException('Payload not found in storage');
    }

    return { buffer: payload, revision: board.revision };
  }

  async saveFile(access: Access, fileId: string, buffer: Buffer) {
    const boardId = this.requireBoard(access);

    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: {
        id: true,
        keyVersion: true,
        hasPayload: true,
        project: { select: { keyVersion: true, organizationId: true } },
      },
    });
    if (!board) {
      throw new NotFoundException(`Board with ID ${boardId} not found`);
    }

    const fileKeyVersion = buffer.readUInt32BE(1);
    const projectKeyVersion = board.project.keyVersion;
    const isRekeyUpload = fileKeyVersion === projectKeyVersion && fileKeyVersion > board.keyVersion;
    if (fileKeyVersion !== board.keyVersion && !isRekeyUpload) {
      throw new BadRequestException('File key version must match board key version');
    }

    if (isRekeyUpload) {
      // The board is about to be re-keyed: the file is stored at the new version beside the
      // current one, and the re-key save switches the row over. It can only replace a known file.
      const known = await this.prisma.boardFile.findUnique({
        where: { boardId_fileId: { boardId: board.id, fileId } },
        select: { id: true, size: true },
      });
      if (!known) {
        throw new BadRequestException('Upload the file at the current key version first');
      }
      const deltaBytes = buffer.length - known.size;
      await this.limitsService.checkStorageLimit(
        this.prisma,
        board.project.organizationId,
        deltaBytes,
      );
      await this.storageService.uploadFile(board.id, fileKeyVersion, fileId, buffer);
      return { success: true, fileId, size: buffer.length };
    }

    const currentFile = await this.prisma.boardFile.findUnique({
      where: { boardId_fileId: { boardId: board.id, fileId } },
      select: { size: true },
    });
    const deltaBytes = buffer.length - (currentFile?.size ?? 0);
    await this.limitsService.checkStorageLimit(
      this.prisma,
      board.project.organizationId,
      deltaBytes,
    );

    const existingFiles = await this.prisma.boardFile.findMany({
      where: {
        boardId,
        fileId: { not: fileId },
      },
      select: { size: true },
    });
    const existingFilesSize = existingFiles.reduce((sum, f) => sum + f.size, 0);
    const payloadSize = board.hasPayload
      ? ((await this.storageService.getPayload(boardId, board.keyVersion))?.length ?? 0)
      : 0;

    if (payloadSize + existingFilesSize + buffer.length > MAX_BOARD_STORAGE_BYTES) {
      throw new PayloadTooLargeException('Board total storage exceeds 50MB limit');
    }

    await this.storageService.uploadFile(board.id, board.keyVersion, fileId, buffer);

    await this.prisma.boardFile.upsert({
      where: {
        boardId_fileId: {
          boardId: board.id,
          fileId,
        },
      },
      create: {
        boardId: board.id,
        fileId,
        keyVersion: board.keyVersion,
        size: buffer.length,
      },
      update: {
        keyVersion: board.keyVersion,
        size: buffer.length,
      },
    });

    return { success: true, fileId, size: buffer.length };
  }

  async getFile(access: Access, fileId: string): Promise<Buffer> {
    const boardId = this.requireBoard(access);

    const boardFile = await this.prisma.boardFile.findUnique({
      where: {
        boardId_fileId: {
          boardId,
          fileId,
        },
      },
    });
    if (!boardFile) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    const buffer = await this.storageService.getFile(boardId, boardFile.keyVersion, fileId);
    if (!buffer) {
      throw new NotFoundException('File content not found in storage');
    }

    return buffer;
  }

  async delete(access: Access) {
    const boardId = this.requireBoard(access);
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { hasPayload: true, keyVersion: true },
    });

    if (!board) {
      throw new NotFoundException(`Board with ID ${boardId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const files = await tx.boardFile.findMany({
        where: { boardId },
        select: { fileId: true, keyVersion: true },
      });
      const objectKeys: string[] = [];
      if (board.hasPayload) {
        objectKeys.push(this.storageService.getBoardPayloadKey(boardId, board.keyVersion));
      }
      for (const file of files) {
        objectKeys.push(this.storageService.getBoardFileKey(boardId, file.keyVersion, file.fileId));
      }
      if (objectKeys.length > 0) {
        await this.blobPurge.enqueue(tx, objectKeys);
      }
      return tx.board.delete({ where: { id: boardId } });
    });
  }

  // ================= Public Sharing Methods ================= //

  async enablePublicShare(access: Access) {
    const boardId = this.requireBoard(access);
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { publicShareToken: true },
    });

    if (!board) {
      throw new NotFoundException(`Board with ID ${boardId} not found`);
    }

    const token = board.publicShareToken ?? randomBytes(16).toString('hex');

    return this.prisma.board.update({
      where: { id: boardId },
      data: {
        isPublic: true,
        publicShareToken: token,
      },
      select: {
        id: true,
        isPublic: true,
        publicShareToken: true,
      },
    });
  }

  async disablePublicShare(access: Access) {
    const boardId = this.requireBoard(access);

    return this.prisma.board.update({
      where: { id: boardId },
      data: {
        isPublic: false,
        publicShareToken: null,
      },
      select: {
        id: true,
        isPublic: true,
        publicShareToken: true,
      },
    });
  }

  async rotatePublicShareToken(access: Access) {
    const boardId = this.requireBoard(access);
    const newToken = randomBytes(16).toString('hex');

    return this.prisma.board.update({
      where: { id: boardId },
      data: {
        isPublic: true,
        publicShareToken: newToken,
      },
      select: {
        id: true,
        isPublic: true,
        publicShareToken: true,
      },
    });
  }

  async getPublicBoard(token: string) {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new NotFoundException('Public board not found or link has expired');
    }

    const board = await this.prisma.board.findUnique({
      where: { publicShareToken: token.trim() },
      select: {
        id: true,
        title: true,
        isPublic: true,
        hasPayload: true,
        keyVersion: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!board || !board.isPublic) {
      throw new NotFoundException('Public board not found or link has expired');
    }

    return {
      id: board.id,
      title: board.title,
      isPublic: true,
      hasPayload: board.hasPayload,
      keyVersion: board.keyVersion,
      revision: board.revision,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    };
  }

  async getPublicPayload(token: string): Promise<{ buffer: Buffer; revision: number }> {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new NotFoundException('Public board not found or link has expired');
    }

    const board = await this.prisma.board.findUnique({
      where: { publicShareToken: token.trim() },
      select: {
        id: true,
        isPublic: true,
        hasPayload: true,
        keyVersion: true,
        revision: true,
      },
    });

    if (!board || !board.isPublic) {
      throw new NotFoundException('Public board not found or link has expired');
    }

    if (!board.hasPayload) {
      throw new NotFoundException('Board has no saved payload');
    }

    const payload = await this.storageService.getPayload(board.id, board.keyVersion);
    if (!payload) {
      throw new NotFoundException('Payload not found in storage');
    }

    return { buffer: payload, revision: board.revision };
  }

  async getPublicFile(token: string, fileId: string): Promise<Buffer> {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new NotFoundException('Public board not found or link has expired');
    }

    const board = await this.prisma.board.findUnique({
      where: { publicShareToken: token.trim() },
      select: { id: true, isPublic: true },
    });
    if (!board || !board.isPublic) {
      throw new NotFoundException('Public board not found or link has expired');
    }

    const boardFile = await this.prisma.boardFile.findUnique({
      where: {
        boardId_fileId: {
          boardId: board.id,
          fileId,
        },
      },
    });
    if (!boardFile) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }

    const buffer = await this.storageService.getFile(board.id, boardFile.keyVersion, fileId);
    if (!buffer) {
      throw new NotFoundException('File content not found in storage');
    }

    return buffer;
  }

  private validateTitle(title: string): void {
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw new BadRequestException('Board title is required');
    }
    if (title.trim().length > 100) {
      throw new BadRequestException('Board title cannot exceed 100 characters');
    }
  }

  private requireWorkspace(access: Access): string {
    if (!access.workspace) {
      throw new ForbiddenException('An active workspace is required');
    }
    return access.workspace.id;
  }

  private requireProject(access: Access): string {
    if (!access.project) {
      throw new ForbiddenException('A project is required');
    }
    return access.project.id;
  }

  private requireBoard(access: Access): string {
    if (!access.boardId) {
      throw new ForbiddenException('A board is required');
    }
    return access.boardId;
  }
}
