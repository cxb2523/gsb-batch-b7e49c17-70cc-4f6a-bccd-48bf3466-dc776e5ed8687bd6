import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import {
  MATRIX_ACTORS,
  MATRIX_ROWS,
  type MatrixActorKey,
  type MatrixRow,
  type MatrixScenario,
} from './access-matrix.rows.js';

/**
 * The authorization matrix, executed against the real database.
 *
 * For every protected route, every role the product defines calls it and the status the rule
 * table implies is asserted. Mutating routes get a fresh workspace per caller so one case cannot
 * change the data the next one sees.
 */
describe('Access matrix (Integration)', () => {
  let harness: IntegrationHarness;
  const actors: Partial<Record<MatrixActorKey, SignedInActor>> = {};

  beforeAll(async () => {
    harness = await createIntegrationHarness();

    for (const key of MATRIX_ACTORS) {
      if (key === 'anonymous') continue;
      const prefix = `matrix-${key.toLowerCase()}`;
      actors[key] = await harness.signIn(`${prefix}@local.com`, key);
    }

    // The public-key lookup needs somebody who has one.
    await harness.prisma.user.update({
      where: { id: actors.owner!.user.id },
      data: { publicKey: 'owner-public-key' },
    });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  async function createScenario(): Promise<MatrixScenario> {
    const workspace = await harness.seedWorkspace({ name: `Matrix ${randomUUID()}` });

    const membership = async (
      key: Exclude<MatrixActorKey, 'anonymous' | 'stranger'>,
      role: 'owner' | 'admin' | 'editor' | 'viewer',
    ) =>
      harness.seedMember({
        organizationId: workspace.id,
        userId: actors[key]!.user.id,
        role,
        encryptedOrgKey: role === 'owner' || role === 'admin' ? 'wrapped-key' : null,
      });

    await membership('owner', 'owner');
    await membership('admin', 'admin');
    const projectAdmin = await membership('projectAdmin', 'editor');
    const projectEditor = await membership('projectEditor', 'editor');
    const projectViewer = await membership('projectViewer', 'viewer');
    const unassignedEditor = await membership('unassignedEditor', 'editor');
    await membership('unassignedViewer', 'viewer');

    const project = await harness.seedProject({
      organizationId: workspace.id,
      name: 'Matrix Project',
    });

    await harness.seedProjectMember({
      projectId: project.id,
      userId: projectAdmin.userId,
      role: 'admin',
    });
    await harness.seedProjectMember({
      projectId: project.id,
      userId: projectEditor.userId,
      role: 'editor',
    });
    await harness.seedProjectMember({
      projectId: project.id,
      userId: projectViewer.userId,
      role: 'viewer',
    });

    const board = await harness.seedBoard({
      projectId: project.id,
      title: 'Matrix Board',
      payload: Buffer.from('encrypted-matrix-payload'),
    });

    await harness.prisma.boardFile.create({
      data: {
        boardId: board.id,
        fileId: 'test-file-id',
        keyVersion: 1,
        size: 33,
      },
    });
    await harness.storage.uploadFile(board.id, 1, 'test-file-id', Buffer.alloc(33));

    // A separate member with the workspace key, so an ownership transfer has a valid target.
    const successorUserId = randomUUID();
    await harness.prisma.user.create({
      data: {
        id: successorUserId,
        name: 'Successor',
        email: `successor-${successorUserId}@local.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const successor = await harness.seedMember({
      organizationId: workspace.id,
      userId: successorUserId,
      role: 'admin',
      encryptedOrgKey: 'successor-wrapped-key',
    });

    const invitation = await harness.prisma.invitation.create({
      data: {
        id: randomUUID(),
        organizationId: workspace.id,
        email: `not-an-actor-${randomUUID()}@local.com`,
        role: 'editor',
        status: 'pending',
        inviterId: actors.owner!.user.id,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    });

    return {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug ?? workspace.id,
      projectId: project.id,
      boardId: board.id,
      invitationId: invitation.id,
      targetMemberId: unassignedEditor.id,
      projectEditorUserId: projectEditor.userId,
      unassignedViewerUserId: actors.unassignedViewer!.user.id,
      publicKeyUserId: actors.owner!.user.id,
      ownershipTargetId: successor.id,
      workspaceAdminUserIds: [actors.owner!.user.id, actors.admin!.user.id, successorUserId],
    };
  }

  async function send(
    row: MatrixRow,
    scenario: MatrixScenario,
    actor: MatrixActorKey,
  ): Promise<request.Response> {
    let cookie = actor === 'anonymous' ? null : actors[actor]!.cookie;

    if (row.freshActor && actor !== 'anonymous') {
      const fresh = await harness.signIn(`matrix-fresh-${randomUUID()}@local.com`, 'Fresh Actor');
      cookie = fresh.cookie;

      if (row.prepare === 'encryption') {
        await harness.prisma.user.update({
          where: { id: fresh.user.id },
          data: {
            kdfSalt: 'salt',
            keyWrapIv: 'iv',
            wrappedPrivateKey: 'wrapped',
            publicKey: 'public',
          },
        });
      }

      if (row.prepare === 'account') {
        await harness.prisma.account.create({
          data: {
            id: randomUUID(),
            accountId: randomUUID(),
            providerId: 'github',
            userId: fresh.user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    }

    let req = harness.request()[row.method](row.url(scenario));
    if (row.stream) {
      // Headers are enough to know the status; the body would never end.
      req = req.buffer(false).parse((response, done) => {
        // At run time this is the raw incoming message, which can be closed.
        if ('destroy' in response && typeof response.destroy === 'function') response.destroy();
        done(null, undefined);
      });
    }
    if (cookie) {
      req = req.set('Cookie', cookie);
    }
    req = req.set('active-organization', scenario.workspaceId);

    if (row.headers) {
      for (const [key, value] of Object.entries(row.headers(scenario))) {
        req = req.set(key, value);
      }
    }

    if (row.body) {
      const payload = row.body(scenario);
      if (row.binary) {
        req = req.set('Content-Type', 'application/octet-stream').send(payload);
      } else {
        req = req.send(payload);
      }
    }

    return req;
  }

  for (const row of MATRIX_ROWS) {
    it(`${row.key} enforces the rule table for every caller`, async () => {
      if (row.mutating) {
        for (const actor of MATRIX_ACTORS) {
          const scenario = await createScenario();
          const res = await send(row, scenario, actor);
          expect(res.status, `${actor} on ${row.key}`).toBe(row.expected[actor]);
        }
        return;
      }

      const scenario = await createScenario();
      for (const actor of MATRIX_ACTORS) {
        const res = await send(row, scenario, actor);
        expect(res.status, `${actor} on ${row.key}`).toBe(row.expected[actor]);
      }
    });
  }

  it('reads the caller membership once per request', async () => {
    const scenario = await createScenario();
    const spy = vi.spyOn(harness.prisma.member, 'findUnique');

    const res = await harness
      .request()
      .patch(`/api/projects/${scenario.projectId}`)
      .set('Cookie', actors.owner!.cookie)
      .set('active-organization', scenario.workspaceId)
      .send({ name: 'One Membership Read' });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
