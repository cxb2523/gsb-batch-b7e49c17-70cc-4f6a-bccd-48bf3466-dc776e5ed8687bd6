import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardsService } from './boards.service.js';
import { defineAbilityFor } from '../access/abilities.js';
import type { InstanceLimitsService } from '../access/instance-limits.service.js';
import type { Access } from '../access/access.types.js';
import type { ProjectRole, WorkspaceRole } from '../access/roles.js';

function accessWith(context: {
  workspaceRole: WorkspaceRole;
  projectRole?: ProjectRole | null;
  workspaceId?: string;
  projectId?: string;
  boardId?: string;
}): Access {
  const projectRole = context.projectRole ?? null;
  return {
    user: { id: 'user-1', name: 'User', email: 'user@local.com' },
    workspace: { id: context.workspaceId ?? 'org-1', slug: 'acme' },
    workspaceRole: context.workspaceRole,
    memberId: 'm1',
    project: context.projectId ? { id: context.projectId } : null,
    projectRole,
    boardId: context.boardId ?? null,
    ability: defineAbilityFor({
      workspaceRole: context.workspaceRole,
      projectRole,
      isAssignedToProject: projectRole !== null,
    }),
  };
}

function makePayload(version: number, revision: number, extraBytes = 28): Buffer {
  const buf = Buffer.alloc(9 + extraBytes);
  buf[0] = 0x01;
  buf.writeUInt32BE(version, 1);
  buf.writeUInt32BE(revision, 5);
  return buf;
}

function makeFile(keyVersion: number, extraBytes = 28): Buffer {
  const buf = Buffer.alloc(5 + extraBytes);
  buf[0] = 0x01;
  buf.writeUInt32BE(keyVersion, 1);
  return buf;
}

function isLimitsService(val: unknown): val is InstanceLimitsService {
  return typeof val === 'object' && val !== null;
}

describe('BoardsService', () => {
  let service: BoardsService;
  let prismaMock: any;
  let storageMock: any;
  let blobPurgeMock: any;

  beforeEach(() => {
    prismaMock = {
      project: { findUnique: vi.fn() },
      projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
      board: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ keyVersion: 1, revision: 0 }),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      boardFile: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    prismaMock.$transaction = vi.fn((callback: (tx: unknown) => unknown) => callback(prismaMock));
    storageMock = {
      uploadPayload: vi.fn(),
      getPayload: vi.fn(),
      uploadFile: vi.fn(),
      hasFile: vi.fn().mockResolvedValue(true),
      getFile: vi.fn(),
      getBoardPayloadKey: vi.fn(
        (boardId: string, keyVersion: number) => `boards/${boardId}/v${keyVersion}.bin`,
      ),
      getBoardFileKey: vi.fn(
        (boardId: string, keyVersion: number, fileId: string) =>
          `boards/${boardId}/v${keyVersion}/files/${fileId}.bin`,
      ),
    };
    blobPurgeMock = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const limitsMock: unknown = {
      checkBoardLimit: vi.fn().mockResolvedValue(undefined),
      checkStorageLimit: vi.fn().mockResolvedValue(undefined),
      checkWorkspaceLimit: vi.fn().mockResolvedValue(undefined),
    };
    if (!isLimitsService(limitsMock)) throw new Error();
    service = new BoardsService(prismaMock, storageMock, blobPurgeMock, limitsMock);
  });

  describe('create', () => {
    it('validates the title before touching the database', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'editor',
        projectId: 'p1',
      });

      await expect(service.create(access, 'b-new', '   ', 'wrapped-key', 1)).rejects.toThrow(
        'Board title is required',
      );
      await expect(
        service.create(access, 'b-new', 'x'.repeat(101), 'wrapped-key', 1),
      ).rejects.toThrow('Board title cannot exceed 100 characters');
      expect(prismaMock.board.create).not.toHaveBeenCalled();
    });

    it('creates the board in the resolved project and stores the wrapped key', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'editor',
        projectId: 'p1',
      });
      prismaMock.project.findUnique.mockResolvedValue({ keyVersion: 4 });
      prismaMock.board.create.mockResolvedValue({ id: 'b1', title: 'Topology', keyVersion: 4 });

      const result = await service.create(access, 'b-new', '  Topology  ', 'wrapped-key', 4);

      expect(result).toEqual({ id: 'b1', title: 'Topology', keyVersion: 4 });
      expect(prismaMock.board.create).toHaveBeenCalledWith({
        data: {
          id: 'b-new',
          title: 'Topology',
          projectId: 'p1',
          encryptedBoardKey: 'wrapped-key',
          keyVersion: 4,
        },
      });
    });

    it('refuses a board wrapped under a stale project key version and creates nothing', async () => {
      const access = accessWith({
        workspaceRole: 'editor',
        projectRole: 'editor',
        projectId: 'p1',
      });
      prismaMock.project.findUnique.mockResolvedValue({ keyVersion: 5 });

      await expect(service.create(access, 'b-new', 'Topology', 'wrapped-key', 4)).rejects.toThrow(
        'project key has changed',
      );
      expect(prismaMock.board.create).not.toHaveBeenCalled();
    });

    it('refuses when no project was resolved', async () => {
      const access = accessWith({ workspaceRole: 'owner' });
      await expect(service.create(access, 'b-new', 'Board', 'wrapped-key', 1)).rejects.toThrow(
        'A project is required',
      );
    });
  });

  describe('findAll', () => {
    it('scopes a non-administrator to the projects they are assigned to', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor' });
      prismaMock.board.count.mockResolvedValue(0);
      prismaMock.board.findMany.mockResolvedValue([]);

      await service.findAll(access);

      expect(prismaMock.board.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            project: { organizationId: 'org-1', members: { some: { userId: 'user-1' } } },
          },
        }),
      );
    });

    it('does not filter projects for a workspace administrator', async () => {
      const access = accessWith({ workspaceRole: 'admin' });
      prismaMock.board.count.mockResolvedValue(0);
      prismaMock.board.findMany.mockResolvedValue([]);

      await service.findAll(access);

      expect(prismaMock.board.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { project: { organizationId: 'org-1' } } }),
      );
    });

    it('rejects a projectId that is not assigned to a non-administrator', async () => {
      const access = accessWith({ workspaceRole: 'editor' });
      prismaMock.project.findUnique.mockResolvedValue({ organizationId: 'org-1' });
      prismaMock.projectMember.findUnique.mockResolvedValue(null);

      await expect(service.findAll(access, { projectId: 'p1' })).rejects.toThrow(
        'You do not have access to this project',
      );
    });

    it('rejects a projectId belonging to another workspace', async () => {
      const access = accessWith({ workspaceRole: 'admin' });
      prismaMock.project.findUnique.mockResolvedValue({ organizationId: 'org-2' });

      await expect(service.findAll(access, { projectId: 'p1' })).rejects.toThrow(
        'Project does not belong to active organization',
      );
    });

    it('clamps pagination to 20..100 and returns totals', async () => {
      const access = accessWith({ workspaceRole: 'admin' });
      prismaMock.board.count.mockResolvedValue(45);
      prismaMock.board.findMany.mockResolvedValue([{ id: 'b1' }]);

      const result = await service.findAll(access, { pagination: { page: 2, limit: 5 } });

      expect(prismaMock.board.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(result.pagination).toEqual({
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: true,
      });
    });
  });

  describe('findOne', () => {
    it('returns the board with the caller grant', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({ id: 'b1' });

      await expect(service.findOne(access)).resolves.toEqual({ id: 'b1' });
      expect(prismaMock.board.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b1' },
          include: {
            project: {
              select: expect.objectContaining({
                members: expect.objectContaining({ where: { userId: 'user-1' } }),
              }),
            },
          },
        }),
      );
    });

    it('throws NotFound when the board does not exist', async () => {
      const access = accessWith({ workspaceRole: 'admin', boardId: 'missing' });
      prismaMock.board.findUnique.mockResolvedValue(null);

      await expect(service.findOne(access)).rejects.toThrow('Board with ID missing not found');
    });
  });

  describe('payload', () => {
    it('writes the object and marks the board as having a payload', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      const buffer = makePayload(1, 1);
      prismaMock.board.findUnique.mockResolvedValue({
        keyVersion: 1,
        revision: 0,
        isPublic: false,
        publicShareToken: null,
        project: { keyVersion: 1 },
      });
      prismaMock.board.update.mockResolvedValue({ id: 'b1', hasPayload: true, revision: 1 });

      await service.savePayload(access, buffer, 0);

      expect(storageMock.uploadPayload).toHaveBeenCalledWith('b1', 1, buffer);
      expect(prismaMock.board.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { hasPayload: true, payloadBytes: 37, revision: 1, updatedAt: expect.any(Date) },
        select: { id: true, hasPayload: true, revision: true, updatedAt: true },
      });
    });

    it('rejects when client revision does not match current board revision (409 BOARD_CONFLICT)', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      const buffer = makePayload(1, 1);
      prismaMock.board.findUnique.mockResolvedValue({
        keyVersion: 1,
        revision: 5,
        isPublic: false,
        publicShareToken: null,
        project: { keyVersion: 1 },
      });

      await expect(service.savePayload(access, buffer, 4)).rejects.toMatchObject({
        response: {
          code: 'BOARD_CONFLICT',
          message: 'This canvas was modified elsewhere.',
          revision: 5,
        },
      });
      expect(storageMock.uploadPayload).not.toHaveBeenCalled();
    });

    it('rejects when payload revision !== board.revision + 1 (400)', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      const buffer = makePayload(1, 3); // skipped revision
      prismaMock.board.findUnique.mockResolvedValue({
        keyVersion: 1,
        revision: 0,
        isPublic: false,
        publicShareToken: null,
        project: { keyVersion: 1 },
      });

      await expect(service.savePayload(access, buffer, 0)).rejects.toThrow(
        'The payload revision must equal current revision + 1',
      );
    });

    it('rejects when total stored size exceeds 50MB limit (413)', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      const buffer = makePayload(1, 1);
      prismaMock.board.findUnique.mockResolvedValue({
        keyVersion: 1,
        revision: 0,
        isPublic: false,
        publicShareToken: null,
        project: { keyVersion: 1 },
      });
      prismaMock.boardFile.findMany.mockResolvedValue([{ size: 50 * 1024 * 1024 }]);

      await expect(service.savePayload(access, buffer, 0)).rejects.toThrow(
        'Board total storage exceeds 50MB limit',
      );
    });

    it('prunes unreferenced files when fileIds is provided', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      const buffer = makePayload(1, 1);
      prismaMock.board.findUnique.mockResolvedValue({
        keyVersion: 1,
        revision: 0,
        isPublic: false,
        publicShareToken: null,
        project: { keyVersion: 1 },
      });
      prismaMock.boardFile.findMany.mockImplementation(
        ({ where }: { where?: { fileId?: { notIn?: string[] } } }) => {
          if (where?.fileId?.notIn) {
            return Promise.resolve([{ fileId: 'orphaned-file', keyVersion: 1 }]);
          }
          return Promise.resolve([]);
        },
      );
      prismaMock.board.update.mockResolvedValue({ id: 'b1', hasPayload: true, revision: 1 });

      await service.savePayload(access, buffer, 0, undefined, ['active-file']);

      expect(blobPurgeMock.enqueue).toHaveBeenCalledWith(prismaMock, [
        'boards/b1/v1/files/orphaned-file.bin',
      ]);
      expect(prismaMock.boardFile.deleteMany).toHaveBeenCalledWith({
        where: { boardId: 'b1', fileId: { in: ['orphaned-file'] } },
      });
    });

    describe('under the board lock', () => {
      const payloadV2 = makePayload(2, 1);
      const rekeyedKey = Buffer.concat([
        Buffer.from([0x01, 0, 0, 0, 2, 0, 0, 0, 2]),
        Buffer.alloc(48),
      ]).toString('base64url');

      beforeEach(() => {
        prismaMock.board.findUnique.mockResolvedValue({
          keyVersion: 1,
          revision: 0,
          isPublic: false,
          publicShareToken: null,
          project: { keyVersion: 2 },
        });
      });

      it('leaves the board on its old key when the new object cannot be written', async () => {
        const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
        storageMock.uploadPayload.mockRejectedValue(new Error('storage down'));

        await expect(service.savePayload(access, payloadV2, 0, rekeyedKey)).rejects.toThrow(
          'storage down',
        );
        expect(prismaMock.board.update).not.toHaveBeenCalled();
        expect(blobPurgeMock.enqueue).not.toHaveBeenCalled();
      });

      it('refuses a re-key while a file has no copy at the new key version', async () => {
        const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
        prismaMock.boardFile.findMany.mockResolvedValue([
          { boardId: 'b1', fileId: 'f1', keyVersion: 1 },
        ]);
        prismaMock.board.findUnique.mockResolvedValue({
          keyVersion: 1,
          revision: 0,
          isPublic: false,
          publicShareToken: null,
          project: { keyVersion: 2 },
        });
        prismaMock.board.findUniqueOrThrow.mockResolvedValue({ keyVersion: 1, revision: 0 });
        storageMock.hasFile.mockResolvedValueOnce(false);

        await expect(service.savePayload(access, payloadV2, 0, rekeyedKey)).rejects.toThrow(
          'must be re-encrypted at the new key version',
        );
        expect(prismaMock.boardFile.updateMany).not.toHaveBeenCalled();
        expect(blobPurgeMock.enqueue).not.toHaveBeenCalled();
      });

      it('queues the old payload and old files when re-keying commits', async () => {
        const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
        prismaMock.boardFile.findMany.mockResolvedValue([
          { boardId: 'b1', fileId: 'f1', keyVersion: 1 },
        ]);
        prismaMock.board.findUnique.mockResolvedValue({
          keyVersion: 1,
          revision: 0,
          isPublic: false,
          publicShareToken: null,
          project: { keyVersion: 2 },
        });
        prismaMock.board.findUniqueOrThrow.mockResolvedValue({ keyVersion: 1, revision: 0 });
        prismaMock.board.update.mockResolvedValue({ id: 'b1', revision: 1 });

        await service.savePayload(access, payloadV2, 0, rekeyedKey);

        expect(storageMock.uploadPayload).toHaveBeenCalledWith('b1', 2, payloadV2);
        expect(blobPurgeMock.enqueue).toHaveBeenCalledWith(prismaMock, [
          'boards/b1/v1.bin',
          'boards/b1/v1/files/f1.bin',
        ]);
        expect(prismaMock.boardFile.updateMany).toHaveBeenCalledWith({
          where: { boardId: 'b1' },
          data: { keyVersion: 2 },
        });
        expect(prismaMock.board.update).toHaveBeenCalledWith({
          where: { id: 'b1' },
          data: {
            encryptedBoardKey: rekeyedKey,
            keyVersion: 2,
            hasPayload: true,
            payloadBytes: 37,
            revision: 1,
            updatedAt: expect.any(Date),
          },
          select: { id: true, hasPayload: true, revision: true, updatedAt: true },
        });
      });

      it('answers BOARD_CONFLICT when revision changed under lock', async () => {
        const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
        prismaMock.board.findUniqueOrThrow.mockResolvedValue({ keyVersion: 1, revision: 1 });

        await expect(service.savePayload(access, payloadV2, 0, rekeyedKey)).rejects.toMatchObject({
          response: { code: 'BOARD_CONFLICT', revision: 1 },
        });
        expect(storageMock.uploadPayload).not.toHaveBeenCalled();
      });

      it('answers KEY_ROTATED and writes nothing when the board moved before the lock was taken', async () => {
        const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
        prismaMock.board.findUniqueOrThrow.mockResolvedValue({ keyVersion: 2, revision: 0 });

        await expect(service.savePayload(access, payloadV2, 0, rekeyedKey)).rejects.toMatchObject({
          response: { code: 'KEY_ROTATED' },
        });
        expect(storageMock.uploadPayload).not.toHaveBeenCalled();
        expect(prismaMock.board.update).not.toHaveBeenCalled();
      });

      it('does not lose a normal save to a re-key that committed in between', async () => {
        const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
        const payloadV1 = makePayload(1, 1);
        prismaMock.board.findUnique.mockResolvedValue({
          keyVersion: 1,
          revision: 0,
          isPublic: false,
          publicShareToken: null,
          project: { keyVersion: 1 },
        });
        prismaMock.board.findUniqueOrThrow.mockResolvedValue({ keyVersion: 2, revision: 0 });

        await expect(service.savePayload(access, payloadV1, 0)).rejects.toMatchObject({
          response: { code: 'KEY_ROTATED' },
        });
        expect(storageMock.uploadPayload).not.toHaveBeenCalled();
      });
    });

    it('returns NotFound when the board has no payload', async () => {
      const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({ hasPayload: false });

      await expect(service.getPayload(access)).rejects.toThrow('Board has no saved payload');
      expect(storageMock.getPayload).not.toHaveBeenCalled();
    });

    it('returns NotFound when storage has no object for a board that claims one', async () => {
      const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({
        hasPayload: true,
        keyVersion: 1,
        revision: 0,
      });
      storageMock.getPayload.mockResolvedValue(null);

      await expect(service.getPayload(access)).rejects.toThrow('Payload not found in storage');
    });

    it('returns the stored bytes and revision', async () => {
      const access = accessWith({ workspaceRole: 'admin', boardId: 'b1' });
      const buffer = Buffer.from('ciphertext');
      prismaMock.board.findUnique.mockResolvedValue({
        hasPayload: true,
        keyVersion: 1,
        revision: 4,
      });
      storageMock.getPayload.mockResolvedValue(buffer);

      await expect(service.getPayload(access)).resolves.toEqual({ buffer, revision: 4 });
    });
  });

  describe('files', () => {
    const validFile = makeFile(1);

    it('uploads file and upserts BoardFile record', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        keyVersion: 1,
        hasPayload: true,
        project: { keyVersion: 1 },
      });
      prismaMock.boardFile.findMany.mockResolvedValue([]);
      storageMock.getPayload.mockResolvedValue(Buffer.alloc(100));

      const res = await service.saveFile(access, 'file-123', validFile);

      expect(res).toEqual({ success: true, fileId: 'file-123', size: validFile.length });
      expect(storageMock.uploadFile).toHaveBeenCalledWith('b1', 1, 'file-123', validFile);
      expect(prismaMock.boardFile.upsert).toHaveBeenCalledWith({
        where: { boardId_fileId: { boardId: 'b1', fileId: 'file-123' } },
        create: { boardId: 'b1', fileId: 'file-123', keyVersion: 1, size: validFile.length },
        update: { keyVersion: 1, size: validFile.length },
      });
    });

    it('rejects when file keyVersion does not match board keyVersion', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        keyVersion: 2,
        hasPayload: false,
        project: { keyVersion: 2 },
      });

      await expect(service.saveFile(access, 'file-123', validFile)).rejects.toThrow(
        'File key version must match board key version',
      );
    });

    it('stores a re-encrypted file at the project key version without touching its row', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      const rekeyedFile = makeFile(2);
      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        keyVersion: 1,
        hasPayload: true,
        project: { keyVersion: 2 },
      });
      prismaMock.boardFile.findUnique.mockResolvedValue({ id: 'row-1' });

      await service.saveFile(access, 'file-123', rekeyedFile);

      expect(storageMock.uploadFile).toHaveBeenCalledWith('b1', 2, 'file-123', rekeyedFile);
      expect(prismaMock.boardFile.upsert).not.toHaveBeenCalled();
    });

    it('refuses a re-key upload for a file the board does not hold', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        keyVersion: 1,
        hasPayload: true,
        project: { keyVersion: 2 },
      });
      prismaMock.boardFile.findUnique.mockResolvedValue(null);

      await expect(service.saveFile(access, 'file-123', makeFile(2))).rejects.toThrow(
        'Upload the file at the current key version first',
      );
      expect(storageMock.uploadFile).not.toHaveBeenCalled();
    });

    it('rejects when total board storage exceeds 50MB', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        keyVersion: 1,
        hasPayload: false,
        project: { keyVersion: 1 },
      });
      prismaMock.boardFile.findMany.mockResolvedValue([{ size: 50 * 1024 * 1024 }]);

      await expect(service.saveFile(access, 'file-123', validFile)).rejects.toThrow(
        'Board total storage exceeds 50MB limit',
      );
    });

    it('getFile returns file content from storage', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.boardFile.findUnique.mockResolvedValue({
        boardId: 'b1',
        fileId: 'f1',
        keyVersion: 1,
      });
      const fileBuffer = Buffer.from('file-data');
      storageMock.getFile.mockResolvedValue(fileBuffer);

      const res = await service.getFile(access, 'f1');
      expect(res).toBe(fileBuffer);
    });

    it('getFile throws 404 when file record does not exist', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.boardFile.findUnique.mockResolvedValue(null);

      await expect(service.getFile(access, 'missing')).rejects.toThrow(
        'File with ID missing not found',
      );
    });

    it('getFile throws 404 when file is missing from storage', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.boardFile.findUnique.mockResolvedValue({
        boardId: 'b1',
        fileId: 'f1',
        keyVersion: 1,
      });
      storageMock.getFile.mockResolvedValue(null);

      await expect(service.getFile(access, 'f1')).rejects.toThrow(
        'File content not found in storage',
      );
    });

    it('getPublicFile returns file buffer for public board', async () => {
      prismaMock.board.findUnique.mockResolvedValue({ id: 'b1', isPublic: true });
      prismaMock.boardFile.findUnique.mockResolvedValue({
        boardId: 'b1',
        fileId: 'f1',
        keyVersion: 1,
      });
      const fileBuffer = Buffer.from('public-file-data');
      storageMock.getFile.mockResolvedValue(fileBuffer);

      const res = await service.getPublicFile('share-tok', 'f1');
      expect(res).toBe(fileBuffer);
    });

    it('getPublicFile throws 404 when public board not found or private', async () => {
      prismaMock.board.findUnique.mockResolvedValue(null);
      await expect(service.getPublicFile('share-tok', 'f1')).rejects.toThrow(
        'Public board not found',
      );

      prismaMock.board.findUnique.mockResolvedValue({ id: 'b1', isPublic: false });
      await expect(service.getPublicFile('share-tok', 'f1')).rejects.toThrow(
        'Public board not found',
      );
    });
  });

  describe('update and delete', () => {
    it('updates the title', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.update.mockResolvedValue({ id: 'b1', title: 'New' });

      await service.update(access, { title: 'New' });

      expect(prismaMock.board.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { title: 'New' },
      });
    });

    it('queues the stored object and files when a board with a payload is deleted', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({ hasPayload: true, keyVersion: 1 });
      prismaMock.boardFile.findMany.mockResolvedValue([
        { boardId: 'b1', fileId: 'f1', keyVersion: 1 },
      ]);
      prismaMock.board.delete.mockResolvedValue({ id: 'b1' });

      await service.delete(access);

      expect(blobPurgeMock.enqueue).toHaveBeenCalledWith(prismaMock, [
        'boards/b1/v1.bin',
        'boards/b1/v1/files/f1.bin',
      ]);
      expect(prismaMock.board.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    });

    it('does not queue anything for a board that never saved a payload', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({ hasPayload: false });
      prismaMock.board.delete.mockResolvedValue({ id: 'b1' });

      await service.delete(access);

      expect(blobPurgeMock.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('public sharing', () => {
    it('keeps an existing token and enables sharing', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.findUnique.mockResolvedValue({ publicShareToken: 'existing' });
      prismaMock.board.update.mockResolvedValue({
        id: 'b1',
        isPublic: true,
        publicShareToken: 'existing',
      });

      await service.enablePublicShare(access);

      expect(prismaMock.board.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isPublic: true, publicShareToken: 'existing' },
        }),
      );
    });

    it('clears the token when sharing is disabled', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.update.mockResolvedValue({
        id: 'b1',
        isPublic: false,
        publicShareToken: null,
      });

      await service.disablePublicShare(access);

      expect(prismaMock.board.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isPublic: false, publicShareToken: null },
        }),
      );
    });

    it('issues a fresh token on rotate', async () => {
      const access = accessWith({ workspaceRole: 'editor', projectRole: 'editor', boardId: 'b1' });
      prismaMock.board.update.mockResolvedValue({
        id: 'b1',
        isPublic: true,
        publicShareToken: 'new',
      });

      await service.rotatePublicShareToken(access);

      const call = prismaMock.board.update.mock.calls[0][0];
      expect(call.data.publicShareToken).toHaveLength(32);
      expect(call.data.isPublic).toBe(true);
    });
  });

  describe('public read endpoints', () => {
    it('rejects a missing, unknown or unpublished token', async () => {
      await expect(service.getPublicBoard('')).rejects.toThrow('Public board not found');
      prismaMock.board.findUnique.mockResolvedValue(null);
      await expect(service.getPublicBoard('token')).rejects.toThrow('Public board not found');
      prismaMock.board.findUnique.mockResolvedValue({ isPublic: false });
      await expect(service.getPublicBoard('token')).rejects.toThrow('Public board not found');
    });

    it('returns the board id and key version the viewer needs, and nothing else', async () => {
      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        title: 'Public',
        isPublic: true,
        hasPayload: true,
        keyVersion: 4,
        revision: 0,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      });

      const board = await service.getPublicBoard('token');
      expect(board).toEqual({
        id: 'b1',
        title: 'Public',
        isPublic: true,
        hasPayload: true,
        keyVersion: 4,
        revision: 0,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      });
      expect(Object.keys(board).sort()).toEqual(
        [
          'createdAt',
          'hasPayload',
          'id',
          'isPublic',
          'keyVersion',
          'revision',
          'title',
          'updatedAt',
        ].sort(),
      );
    });

    it('serves the public payload only for a public board with one', async () => {
      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        isPublic: true,
        hasPayload: true,
        keyVersion: 1,
        revision: 2,
      });
      const buffer = Buffer.from('ciphertext');
      storageMock.getPayload.mockResolvedValue(buffer);

      await expect(service.getPublicPayload('token')).resolves.toEqual({ buffer, revision: 2 });

      prismaMock.board.findUnique.mockResolvedValue({
        id: 'b1',
        isPublic: true,
        hasPayload: false,
      });
      await expect(service.getPublicPayload('token')).rejects.toThrow('Board has no saved payload');
    });
  });
});
