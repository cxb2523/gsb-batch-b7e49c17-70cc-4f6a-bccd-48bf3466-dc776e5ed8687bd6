import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { boardPayload, V1_WRAPPED_KEY, wrappedKeyWithVersions } from './fixtures.js';

describe('Images and save conflicts (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let stranger: SignedInActor;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
  });

  beforeEach(async () => {
    await harness.resetDatabase();
    [owner, stranger] = await Promise.all([
      harness.signIn('images-owner@local.com', 'Images Owner'),
      harness.signIn('images-stranger@local.com', 'Stranger'),
    ]);
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  async function seedBoard(options: { isPublic?: boolean } = {}) {
    const workspace = await harness.seedWorkspace({ name: 'Images Workspace' });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
      encryptedOrgKey: V1_WRAPPED_KEY,
    });
    const project = await harness.seedProject({
      organizationId: workspace.id,
      name: 'Images Project',
    });
    const board = await harness.seedBoard({
      projectId: project.id,
      title: 'Images Board',
      isPublic: options.isPublic ?? false,
      publicShareToken: options.isPublic ? 'test-public-token' : null,
      keyVersion: 1,
    });

    return { workspace, project, board };
  }

  function filePayload(version = 1, size = 64): Buffer {
    const bytes = Buffer.alloc(size);
    bytes[0] = 0x01;
    bytes.writeUInt32BE(version, 1);
    return bytes;
  }

  describe('Revision counter & save conflicts', () => {
    it('refuses save payload with 400 when x-board-revision header is missing', async () => {
      const { workspace, board } = await seedBoard();
      const payload = boardPayload(1, 1);

      const res = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/x-board-revision/i);
    });

    it('refuses save payload when payload revision skips current + 1', async () => {
      const { workspace, board } = await seedBoard();
      // current revision is 0, payload revision is 2 (skipped 1)
      const payload = boardPayload(1, 2);

      const res = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('Content-Type', 'application/octet-stream')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/revision/i);
    });

    it('handles concurrent saves: first wins, second gets 409 BOARD_CONFLICT, and stored payload is winner', async () => {
      const { workspace, board } = await seedBoard();
      const winnerPayload = boardPayload(1, 1);
      winnerPayload.write('WINNER-PAYLOAD', 9);

      const loserPayload = boardPayload(1, 1);
      loserPayload.write('LOSER-PAYLOAD', 9);

      // Save 1 (Winner)
      const res1 = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('Content-Type', 'application/octet-stream')
        .send(winnerPayload);

      expect(res1.status).toBe(200);
      expect(res1.headers['x-board-revision']).toBe('1');
      expect(res1.body.revision).toBe(1);

      // Save 2 (Loser, still sending x-board-revision: 0)
      const res2 = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('Content-Type', 'application/octet-stream')
        .send(loserPayload);

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe('BOARD_CONFLICT');
      expect(res2.body.revision).toBe(1);

      // Verify the stored payload is indeed the winner's payload
      const getRes = await harness
        .request()
        .get(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(getRes.status).toBe(200);
      expect(getRes.headers['x-board-revision']).toBe('1');
      expect(getRes.body.toString('utf8')).toContain('WINNER-PAYLOAD');
    });
  });

  describe('Images & Board Files', () => {
    it('round-trips an encrypted file upload and download', async () => {
      const { workspace, board } = await seedBoard();
      const fileId = 'test-file-123';
      const fileData = filePayload(1, 128);
      fileData.write('MY-ENCRYPTED-IMAGE-DATA', 5);

      // Upload file
      const uploadRes = await harness
        .request()
        .put(`/api/boards/${board.id}/files/${fileId}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(fileData);

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.success).toBe(true);
      expect(uploadRes.body.fileId).toBe(fileId);

      // Verify database record
      const dbFile = await harness.prisma.boardFile.findUnique({
        where: { boardId_fileId: { boardId: board.id, fileId } },
      });
      expect(dbFile).not.toBeNull();
      expect(dbFile?.size).toBe(128);

      // Download file
      const downloadRes = await harness
        .request()
        .get(`/api/boards/${board.id}/files/${fileId}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('application/octet-stream');
      expect(downloadRes.body.toString('utf8')).toContain('MY-ENCRYPTED-IMAGE-DATA');
    });

    it('refuses invalid file IDs and cross-tenant access', async () => {
      const { workspace, board } = await seedBoard();
      const fileData = filePayload(1, 64);

      // Bad fileId shape
      const badIdRes = await harness
        .request()
        .put(`/api/boards/${board.id}/files/invalid@file!id`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(fileData);

      expect(badIdRes.status).toBe(400);

      // Stranger cannot read or upload to board
      const strangerUpload = await harness
        .request()
        .put(`/api/boards/${board.id}/files/file-valid-id`)
        .set('Cookie', stranger.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(fileData);

      expect(strangerUpload.status).toBe(403);
    });

    it('enforces file size cap of 8MB', async () => {
      const { workspace, board } = await seedBoard();
      // Over 8MB (8 * 1024 * 1024 + 10)
      const oversized = Buffer.alloc(8 * 1024 * 1024 + 10);
      oversized[0] = 0x01;
      oversized.writeUInt32BE(1, 1);

      const res = await harness
        .request()
        .put(`/api/boards/${board.id}/files/oversized-file`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(oversized);

      expect(res.status).toBe(413);
    });

    it('enforces 100-file cap in x-board-file-ids header', async () => {
      const { workspace, board } = await seedBoard();
      const payload = boardPayload(1, 1);
      const tooManyFileIds = Array.from({ length: 101 }, (_, i) => `file-${i}`).join(',');

      const res = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('x-board-file-ids', tooManyFileIds)
        .set('Content-Type', 'application/octet-stream')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/100/i);
    });

    it('serves public file only while public link is active, and 404 when revoked', async () => {
      const { workspace, board } = await seedBoard({ isPublic: true });
      const fileId = 'public-image-1';
      const fileData = filePayload(1, 64);

      // Upload file as owner
      await harness
        .request()
        .put(`/api/boards/${board.id}/files/${fileId}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(fileData);

      // Public access succeeds without session
      const publicRes = await harness
        .request()
        .get(`/api/public/boards/test-public-token/files/${fileId}`);

      expect(publicRes.status).toBe(200);

      // Revoke public share
      const revokeRes = await harness
        .request()
        .delete(`/api/boards/${board.id}/public-share`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(revokeRes.status).toBe(200);

      // Public access now returns 404
      const revokedAccess = await harness
        .request()
        .get(`/api/public/boards/test-public-token/files/${fileId}`);

      expect(revokedAccess.status).toBe(404);
    });

    it('prunes unreferenced files on save and enqueues them for blob purge', async () => {
      const { workspace, board } = await seedBoard();
      // Upload file 1 and file 2
      await harness
        .request()
        .put(`/api/boards/${board.id}/files/file-keep`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(filePayload(1, 64));

      await harness
        .request()
        .put(`/api/boards/${board.id}/files/file-prune`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(filePayload(1, 64));

      expect(await harness.prisma.boardFile.count({ where: { boardId: board.id } })).toBe(2);

      // Save payload specifying only file-keep
      const saveRes = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('x-board-file-ids', 'file-keep')
        .set('Content-Type', 'application/octet-stream')
        .send(boardPayload(1, 1));

      expect(saveRes.status).toBe(200);

      // file-prune should be removed from boardFile
      const remainingFiles = await harness.prisma.boardFile.findMany({
        where: { boardId: board.id },
      });
      expect(remainingFiles.map((f) => f.fileId)).toEqual(['file-keep']);

      // file-prune should be in pending_blob_deletion
      const pending = await harness.prisma.pendingBlobDeletion.findMany();
      expect(pending.some((p) => p.objectKey.includes('file-prune'))).toBe(true);
    });

    it('prunes every file when the save lists none (an empty header value)', async () => {
      const { workspace, board } = await seedBoard();
      await harness
        .request()
        .put(`/api/boards/${board.id}/files/file-gone`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(filePayload(1, 64));

      const saveRes = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('x-board-file-ids', '')
        .set('Content-Type', 'application/octet-stream')
        .send(boardPayload(1, 1));

      expect(saveRes.status).toBe(200);
      expect(await harness.prisma.boardFile.count({ where: { boardId: board.id } })).toBe(0);
    });

    it('board deletion enqueues both payload and image files for blob purge', async () => {
      const { workspace, board } = await seedBoard();
      // Save payload
      await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('Content-Type', 'application/octet-stream')
        .send(boardPayload(1, 1));

      // Upload file
      await harness
        .request()
        .put(`/api/boards/${board.id}/files/file-del`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(filePayload(1, 64));

      // Clear any prior pending blob deletions
      await harness.prisma.pendingBlobDeletion.deleteMany();

      // Delete board
      const delRes = await harness
        .request()
        .delete(`/api/boards/${board.id}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(delRes.status).toBe(200);

      // Verify pending blob deletion has payload and file
      const queued = await harness.prisma.pendingBlobDeletion.findMany();
      const keys = queued.map((q) => q.objectKey);
      expect(keys.some((k) => k === `boards/${board.id}/v1.bin`)).toBe(true);
      expect(keys.some((k) => k.includes('file-del'))).toBe(true);
    });

    it('re-key updates BoardFile keyVersion and enqueues old files for purge', async () => {
      const { workspace, project, board } = await seedBoard();
      // Upload file at keyVersion 1
      await harness
        .request()
        .put(`/api/boards/${board.id}/files/rekey-file`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(filePayload(1, 64));

      // First save payload at v1
      await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('x-board-file-ids', 'rekey-file')
        .set('Content-Type', 'application/octet-stream')
        .send(boardPayload(1, 1));

      // Rotate project key to v2
      await harness.prisma.project.update({
        where: { id: project.id },
        data: { keyVersion: 2 },
      });

      // Clear pending deletions
      await harness.prisma.pendingBlobDeletion.deleteMany();

      // Re-key save payload at v2
      const rekeyedKey = wrappedKeyWithVersions([2, 2]);
      const rekeyPayload = boardPayload(2, 2);

      // Without the file re-encrypted at v2 the re-key is refused and nothing moves.
      const refused = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '1')
        .set('x-encrypted-board-key', rekeyedKey)
        .set('x-board-file-ids', 'rekey-file')
        .set('Content-Type', 'application/octet-stream')
        .send(rekeyPayload);
      expect(refused.status).toBe(400);
      expect(
        (
          await harness.prisma.boardFile.findUniqueOrThrow({
            where: { boardId_fileId: { boardId: board.id, fileId: 'rekey-file' } },
          })
        ).keyVersion,
      ).toBe(1);

      const reuploaded = await harness
        .request()
        .put(`/api/boards/${board.id}/files/rekey-file`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('Content-Type', 'application/octet-stream')
        .send(filePayload(2, 64));
      expect(reuploaded.status).toBe(200);
      // The row still points at v1 until the re-key save commits.
      expect(
        (
          await harness.prisma.boardFile.findUniqueOrThrow({
            where: { boardId_fileId: { boardId: board.id, fileId: 'rekey-file' } },
          })
        ).keyVersion,
      ).toBe(1);

      const rekeyRes = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '1')
        .set('x-encrypted-board-key', rekeyedKey)
        .set('x-board-file-ids', 'rekey-file')
        .set('Content-Type', 'application/octet-stream')
        .send(rekeyPayload);

      expect(rekeyRes.status).toBe(200);

      // Verify BoardFile keyVersion was bumped to 2
      const updatedFile = await harness.prisma.boardFile.findUnique({
        where: { boardId_fileId: { boardId: board.id, fileId: 'rekey-file' } },
      });
      expect(updatedFile?.keyVersion).toBe(2);

      // Verify old v1 file blob was enqueued for purge
      const queued = await harness.prisma.pendingBlobDeletion.findMany();
      const keys = queued.map((q) => q.objectKey);
      expect(keys.some((k) => k === `boards/${board.id}/v1.bin`)).toBe(true);
      expect(
        keys.some((k) => k.includes('v1/files/rekey-file') || k.includes('files/rekey-file/v1')),
      ).toBe(true);
    });
  });
});
