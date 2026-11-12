import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { randomUUID } from 'node:crypto';
import { V1_BOARD_PAYLOAD, V1_WRAPPED_KEY } from './fixtures.js';

describe('Multi-Tenant & Role-Based Read Isolation Matrix (Integration)', () => {
  let harness: IntegrationHarness;

  let orgAId: string;
  let orgBId: string;
  let projectAId: string;
  let projectBId: string;
  let boardAId: string;
  let boardAStorageKey: string;
  const boardAPayloadBytes = Buffer.from('ciphertext-workspace-a-secret-board');

  let actors: {
    owner: SignedInActor;
    admin: SignedInActor;
    assignedMember: SignedInActor;
    unassignedMember: SignedInActor;
    viewer: SignedInActor;
    stranger: SignedInActor;
  };

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();

    const [owner, admin, assignedMember, unassignedMember, viewer, stranger] = await Promise.all([
      harness.signIn('owner-a@local.com', 'Owner A'),
      harness.signIn('admin-a@local.com', 'Admin A'),
      harness.signIn('member-assigned-a@local.com', 'Assigned Member A'),
      harness.signIn('member-unassigned-a@local.com', 'Unassigned Member A'),
      harness.signIn('viewer-a@local.com', 'Viewer A'),
      harness.signIn('stranger-b@local.com', 'Stranger B'),
    ]);

    actors = { owner, admin, assignedMember, unassignedMember, viewer, stranger };

    const orgA = await harness.seedWorkspace({ name: 'Workspace Alpha', slug: 'workspace-alpha' });
    const orgB = await harness.seedWorkspace({ name: 'Workspace Beta', slug: 'workspace-beta' });
    orgAId = orgA.id;
    orgBId = orgB.id;

    await Promise.all([
      harness.seedMember({ organizationId: orgAId, userId: owner.user.id, role: 'owner' }),
      harness.seedMember({ organizationId: orgAId, userId: admin.user.id, role: 'admin' }),
      harness.seedMember({
        organizationId: orgAId,
        userId: assignedMember.user.id,
        role: 'editor',
      }),
      harness.seedMember({
        organizationId: orgAId,
        userId: unassignedMember.user.id,
        role: 'editor',
      }),
      harness.seedMember({ organizationId: orgAId, userId: viewer.user.id, role: 'viewer' }),
      harness.seedMember({ organizationId: orgBId, userId: stranger.user.id, role: 'owner' }),
    ]);

    const projectA = await harness.seedProject({
      organizationId: orgAId,
      name: 'Alpha Confidential Project',
    });
    const projectB = await harness.seedProject({
      organizationId: orgBId,
      name: 'Beta Project',
    });
    projectAId = projectA.id;
    projectBId = projectB.id;

    await Promise.all([
      harness.seedProjectMember({
        projectId: projectAId,
        userId: assignedMember.user.id,
        role: 'editor',
      }),
      harness.seedProjectMember({
        projectId: projectAId,
        userId: viewer.user.id,
        role: 'viewer',
      }),
      harness.seedProjectMember({
        projectId: projectBId,
        userId: stranger.user.id,
        role: 'admin',
      }),
    ]);

    const boardA = await harness.seedBoard({
      projectId: projectAId,
      title: 'Alpha Architecture Board',
      payload: boardAPayloadBytes,
    });
    boardAId = boardA.id;
    boardAStorageKey = `boards/${boardAId}/v1.bin`;
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
    }
  });

  describe('GET /api/projects', () => {
    it.each([
      { role: 'owner', actorKey: 'owner' as const, canSeeProjectA: true },
      { role: 'admin', actorKey: 'admin' as const, canSeeProjectA: true },
      {
        role: 'member assigned to project',
        actorKey: 'assignedMember' as const,
        canSeeProjectA: true,
      },
      {
        role: 'member not assigned to project',
        actorKey: 'unassignedMember' as const,
        canSeeProjectA: false,
      },
      { role: 'viewer', actorKey: 'viewer' as const, canSeeProjectA: true },
    ])(
      'returns visible project list for $role in Workspace A',
      async ({ actorKey, canSeeProjectA }) => {
        const res = await harness
          .request()
          .get('/api/projects')
          .set('Cookie', actors[actorKey].cookie)
          .set('active-organization', orgAId);

        expect(res.status).toBe(200);
        const items: Array<{ id: string }> = Array.isArray(res.body)
          ? res.body
          : Array.isArray(res.body?.items)
            ? res.body.items
            : [];
        const ids = items.map((p) => p.id);
        if (canSeeProjectA) {
          expect(ids).toContain(projectAId);
        } else {
          expect(ids).not.toContain(projectAId);
        }
      },
    );

    it('rejects stranger in another workspace with 403 when querying Workspace A projects', async () => {
      const res = await harness
        .request()
        .get('/api/projects')
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgAId);

      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await harness.request().get('/api/projects').set('active-organization', orgAId);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/projects/:id/members', () => {
    it.each([
      { role: 'owner', actorKey: 'owner' as const, expectedStatus: 200 },
      { role: 'admin', actorKey: 'admin' as const, expectedStatus: 200 },
      {
        role: 'member assigned to project',
        actorKey: 'assignedMember' as const,
        expectedStatus: 200,
      },
      {
        role: 'member not assigned to project',
        actorKey: 'unassignedMember' as const,
        expectedStatus: 403,
      },
      { role: 'viewer', actorKey: 'viewer' as const, expectedStatus: 200 },
    ])(
      'enforces access ($expectedStatus) for $role on GET /api/projects/:id/members',
      async ({ actorKey, expectedStatus }) => {
        const res = await harness
          .request()
          .get(`/api/projects/${projectAId}/members`)
          .set('Cookie', actors[actorKey].cookie)
          .set('active-organization', orgAId);

        expect(res.status).toBe(expectedStatus);
      },
    );

    it('rejects stranger spoofing Workspace A header with 403 on GET /api/projects/:id/members', async () => {
      const res = await harness
        .request()
        .get(`/api/projects/${projectAId}/members`)
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgAId);

      expect(res.status).toBe(403);
    });

    it('rejects stranger using their own workspace header when targeting Workspace A project ID', async () => {
      const res = await harness
        .request()
        .get(`/api/projects/${projectAId}/members`)
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgBId);

      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await harness
        .request()
        .get(`/api/projects/${projectAId}/members`)
        .set('active-organization', orgAId);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/boards', () => {
    it.each([
      { role: 'owner', actorKey: 'owner' as const, canSeeBoardA: true },
      { role: 'admin', actorKey: 'admin' as const, canSeeBoardA: true },
      {
        role: 'member assigned to project',
        actorKey: 'assignedMember' as const,
        canSeeBoardA: true,
      },
      {
        role: 'member not assigned to project',
        actorKey: 'unassignedMember' as const,
        canSeeBoardA: false,
      },
      { role: 'viewer', actorKey: 'viewer' as const, canSeeBoardA: true },
    ])(
      'filters workspace board list for $role in Workspace A',
      async ({ actorKey, canSeeBoardA }) => {
        const res = await harness
          .request()
          .get('/api/boards')
          .set('Cookie', actors[actorKey].cookie)
          .set('active-organization', orgAId);

        expect(res.status).toBe(200);
        const items: Array<{ id: string }> = Array.isArray(res.body?.items)
          ? res.body.items
          : Array.isArray(res.body)
            ? res.body
            : [];
        const ids = items.map((b) => b.id);
        if (canSeeBoardA) {
          expect(ids).toContain(boardAId);
        } else {
          expect(ids).not.toContain(boardAId);
        }
      },
    );

    it('rejects member not assigned to project with 403 when filtering by projectId directly', async () => {
      const res = await harness
        .request()
        .get(`/api/boards?projectId=${projectAId}`)
        .set('Cookie', actors.unassignedMember.cookie)
        .set('active-organization', orgAId);

      expect(res.status).toBe(403);
    });

    it('rejects stranger in another workspace with 403 when querying Workspace A boards', async () => {
      const res = await harness
        .request()
        .get('/api/boards')
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgAId);

      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await harness.request().get('/api/boards').set('active-organization', orgAId);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/boards/:id', () => {
    it.each([
      { role: 'owner', actorKey: 'owner' as const, expectedStatus: 200 },
      { role: 'admin', actorKey: 'admin' as const, expectedStatus: 200 },
      {
        role: 'member assigned to project',
        actorKey: 'assignedMember' as const,
        expectedStatus: 200,
      },
      {
        role: 'member not assigned to project',
        actorKey: 'unassignedMember' as const,
        expectedStatus: 403,
      },
      { role: 'viewer', actorKey: 'viewer' as const, expectedStatus: 200 },
      { role: 'stranger in another workspace', actorKey: 'stranger' as const, expectedStatus: 403 },
    ])(
      'enforces access ($expectedStatus) for $role on GET /api/boards/:id',
      async ({ actorKey, expectedStatus }) => {
        const res = await harness
          .request()
          .get(`/api/boards/${boardAId}`)
          .set('Cookie', actors[actorKey].cookie)
          .set('active-organization', orgAId);

        expect(res.status).toBe(expectedStatus);
      },
    );

    it('rejects unauthenticated requests with 401', async () => {
      const res = await harness
        .request()
        .get(`/api/boards/${boardAId}`)
        .set('active-organization', orgAId);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/boards/:id/payload', () => {
    it.each([
      { role: 'owner', actorKey: 'owner' as const, expectedStatus: 200 },
      { role: 'admin', actorKey: 'admin' as const, expectedStatus: 200 },
      {
        role: 'member assigned to project',
        actorKey: 'assignedMember' as const,
        expectedStatus: 200,
      },
      {
        role: 'member not assigned to project',
        actorKey: 'unassignedMember' as const,
        expectedStatus: 403,
      },
      { role: 'viewer', actorKey: 'viewer' as const, expectedStatus: 200 },
      { role: 'stranger in another workspace', actorKey: 'stranger' as const, expectedStatus: 403 },
    ])(
      'enforces access ($expectedStatus) for $role on GET /api/boards/:id/payload',
      async ({ actorKey, expectedStatus }) => {
        const res = await harness
          .request()
          .get(`/api/boards/${boardAId}/payload`)
          .set('Cookie', actors[actorKey].cookie)
          .set('active-organization', orgAId)
          .buffer(true)
          .parse((response, callback) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => callback(null, Buffer.concat(chunks)));
          });

        expect(res.status).toBe(expectedStatus);
        if (expectedStatus === 200) {
          expect(Buffer.isBuffer(res.body)).toBe(true);
          if (Buffer.isBuffer(res.body)) {
            expect(Buffer.compare(res.body, boardAPayloadBytes)).toBe(0);
          }
        }
      },
    );

    it('rejects unauthenticated requests with 401', async () => {
      const res = await harness
        .request()
        .get(`/api/boards/${boardAId}/payload`)
        .set('active-organization', orgAId);

      expect(res.status).toBe(401);
    });
  });

  describe('C1 & H16 regression suite (Batch 7)', () => {
    it('C1: prevents a user in Workspace B from creating, updating, or deleting a board to read or destroy Workspace A object', async () => {
      const createRes = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgBId)
        .send({
          id: randomUUID(),
          projectId: projectBId,
          title: 'Cross Tenant Pointer Board',
          encryptedBoardKey: V1_WRAPPED_KEY,
          projectKeyVersion: 1,
          payloadUrl: boardAStorageKey,
        });

      expect(createRes.status).toBe(201);
      const attackerBoardId = String(createRes.body.id);

      // 1. Reading the attacker's new board payload returns 404 (not Workspace A's bytes)
      const payloadRes = await harness
        .request()
        .get(`/api/boards/${attackerBoardId}/payload`)
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgBId);

      expect(payloadRes.status).toBe(404);

      // 2. PATCH /api/boards/:id with a payloadUrl does not change where payloads are read from or written to
      const patchRes = await harness
        .request()
        .patch(`/api/boards/${attackerBoardId}`)
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgBId)
        .send({
          title: 'Patched Attacker Board',
          payloadUrl: boardAStorageKey,
        });

      expect(patchRes.status).toBe(200);

      const postPatchReadRes = await harness
        .request()
        .get(`/api/boards/${attackerBoardId}/payload`)
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgBId);

      expect(postPatchReadRes.status).toBe(404);

      const attackerPayload = V1_BOARD_PAYLOAD;
      const putRes = await harness
        .request()
        .put(`/api/boards/${attackerBoardId}/payload`)
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgBId)
        .set('x-board-revision', '0')
        .set('Content-Type', 'application/octet-stream')
        .send(attackerPayload);

      expect(putRes.status).toBe(200);
      expect(putRes.body).toMatchObject({ success: true, hasPayload: true });
      expect(putRes.body.payloadUrl).toBeUndefined();
      // Attacker's write went to boards/<attackerBoardId>.bin, leaving Workspace A's object untouched
      expect(
        Buffer.compare(harness.storage.objects.get(boardAStorageKey)!, boardAPayloadBytes),
      ).toBe(0);
      expect(
        Buffer.compare(
          harness.storage.objects.get(`boards/${attackerBoardId}/v1.bin`)!,
          attackerPayload,
        ),
      ).toBe(0);

      // 3. Deleting the attacker's board does NOT delete Workspace A's stored object
      const delRes = await harness
        .request()
        .delete(`/api/boards/${attackerBoardId}`)
        .set('Cookie', actors.stranger.cookie)
        .set('active-organization', orgBId);

      expect(delRes.status).toBe(200);
      await harness.purge.processDue();
      expect(harness.storage.objects.has(`boards/${attackerBoardId}/v1.bin`)).toBe(false);
      expect(harness.storage.objects.has(boardAStorageKey)).toBe(true);
      expect(
        Buffer.compare(harness.storage.objects.get(boardAStorageKey)!, boardAPayloadBytes),
      ).toBe(0);
    });

    it('completes normal board payload lifecycle: save, read, public share (without leaking id), and delete', async () => {
      const createRes = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', actors.owner.cookie)
        .set('active-organization', orgAId)
        .send({
          id: randomUUID(),
          projectId: projectAId,
          title: 'Lifecycle Test Board',
          encryptedBoardKey: V1_WRAPPED_KEY,
          projectKeyVersion: 1,
        });

      expect(createRes.status).toBe(201);
      const lifecycleBoardId = String(createRes.body.id);
      expect(createRes.body.hasPayload).toBe(false);

      const payloadBytes = V1_BOARD_PAYLOAD;
      const saveRes = await harness
        .request()
        .put(`/api/boards/${lifecycleBoardId}/payload`)
        .set('Cookie', actors.owner.cookie)
        .set('active-organization', orgAId)
        .set('x-board-revision', '0')
        .set('Content-Type', 'application/octet-stream')
        .send(payloadBytes);

      expect(saveRes.status).toBe(200);
      expect(saveRes.body).toMatchObject({ success: true, hasPayload: true });
      expect(saveRes.body.payloadUrl).toBeUndefined();
      expect(harness.storage.objects.has(`boards/${lifecycleBoardId}/v1.bin`)).toBe(true);

      const readRes = await harness
        .request()
        .get(`/api/boards/${lifecycleBoardId}/payload`)
        .set('Cookie', actors.owner.cookie)
        .set('active-organization', orgAId)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(readRes.status).toBe(200);
      expect(Buffer.isBuffer(readRes.body)).toBe(true);
      if (Buffer.isBuffer(readRes.body)) {
        expect(Buffer.compare(readRes.body, payloadBytes)).toBe(0);
      }

      // Enable public share and verify public endpoints
      const shareRes = await harness
        .request()
        .post(`/api/boards/${lifecycleBoardId}/public-share`)
        .set('Cookie', actors.owner.cookie)
        .set('active-organization', orgAId);

      expect(shareRes.status).toBe(201);
      const token = String(shareRes.body.publicShareToken);
      expect(token).toBeTruthy();

      const pubMetaRes = await harness.request().get(`/api/public/boards/${token}`);
      expect(pubMetaRes.status).toBe(200);
      expect(pubMetaRes.body.title).toBe('Lifecycle Test Board');
      // The viewer needs the board id and key version to bind decryption; nothing else is new.
      expect(pubMetaRes.body.id).toBe(lifecycleBoardId);
      expect(pubMetaRes.body.keyVersion).toBe(1);
      expect(Object.keys(pubMetaRes.body).sort()).toEqual(
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

      const pubPayloadRes = await harness
        .request()
        .get(`/api/public/boards/${token}/payload`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(pubPayloadRes.status).toBe(200);
      expect(Buffer.isBuffer(pubPayloadRes.body)).toBe(true);
      if (Buffer.isBuffer(pubPayloadRes.body)) {
        expect(Buffer.compare(pubPayloadRes.body, payloadBytes)).toBe(0);
      }

      // Delete the board and verify the S3 object is removed
      const deleteRes = await harness
        .request()
        .delete(`/api/boards/${lifecycleBoardId}`)
        .set('Cookie', actors.owner.cookie)
        .set('active-organization', orgAId);

      expect(deleteRes.status).toBe(200);
      await harness.purge.processDue();
      expect(harness.storage.objects.has(`boards/${lifecycleBoardId}/v1.bin`)).toBe(false);
    });

    it('H16: always paginates GET /api/boards (default 20 items, limit capped at 100)', async () => {
      const pagProject = await harness.seedProject({
        organizationId: orgAId,
        name: 'Pagination Test Project',
      });

      await Promise.all(
        Array.from({ length: 25 }, (_, idx) =>
          harness.seedBoard({
            projectId: pagProject.id,
            title: `Paginated Board ${idx + 1}`,
          }),
        ),
      );

      // 1. Default pagination (no page or limit params)
      const defaultRes = await harness
        .request()
        .get(`/api/boards?projectId=${pagProject.id}`)
        .set('Cookie', actors.owner.cookie)
        .set('active-organization', orgAId);

      expect(defaultRes.status).toBe(200);
      expect(Array.isArray(defaultRes.body.items)).toBe(true);
      expect(defaultRes.body.items).toHaveLength(20);
      expect(defaultRes.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 25,
        totalPages: 2,
        hasNextPage: true,
        hasPrevPage: false,
      });

      // 2. Requesting limit=1000 is capped at the schema maximum of 100
      const overLimitRes = await harness
        .request()
        .get(`/api/boards?projectId=${pagProject.id}&limit=1000`)
        .set('Cookie', actors.owner.cookie)
        .set('active-organization', orgAId);

      expect(overLimitRes.status).toBe(200);
      expect(overLimitRes.body.items).toHaveLength(25);
      expect(overLimitRes.body.pagination.limit).toBe(100);
      expect(overLimitRes.body.pagination.total).toBe(25);
    });
  });
});
