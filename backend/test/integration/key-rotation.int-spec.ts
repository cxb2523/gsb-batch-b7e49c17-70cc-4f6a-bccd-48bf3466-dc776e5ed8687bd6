import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { boardPayload, V1_WRAPPED_KEY, wrappedKeyWithVersions } from './fixtures.js';
import { UsersService } from '../../src/users/users.service.js';

/** R5 part 1: due flags, atomic rotation, the history chain and versioned saves. */
describe('Project key rotation (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let admin: SignedInActor;
  let editorA: SignedInActor;
  let editorB: SignedInActor;
  let pending: SignedInActor;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
  });

  beforeEach(async () => {
    await harness.resetDatabase();
    [owner, admin, editorA, editorB, pending] = await Promise.all([
      harness.signIn('rotation-owner@local.com', 'Rotation Owner'),
      harness.signIn('rotation-admin@local.com', 'Rotation Admin'),
      harness.signIn('rotation-a@local.com', 'Editor A'),
      harness.signIn('rotation-b@local.com', 'Editor B'),
      harness.signIn('rotation-pending@local.com', 'Pending Editor'),
    ]);
    await harness.prisma.user.updateMany({
      where: { id: { in: [editorA.user.id, editorB.user.id] } },
      data: { publicKey: 'member-public-key' },
    });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  async function seedWorkspaceWithRoles(options: { allProjects?: number } = {}) {
    const workspace = await harness.seedWorkspace({ name: 'Rotation Workspace' });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
      encryptedOrgKey: V1_WRAPPED_KEY,
    });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: admin.user.id,
      role: 'admin',
      encryptedOrgKey: V1_WRAPPED_KEY,
    });
    await Promise.all(
      [editorA, editorB, pending].map((actor) =>
        harness.seedMember({
          organizationId: workspace.id,
          userId: actor.user.id,
          role: 'editor',
        }),
      ),
    );
    const projectCount = options.allProjects ?? 3;
    const projectIndices = Array.from({ length: projectCount }, (_, i) => i);
    const projects = await Promise.all(
      projectIndices.map((index) =>
        harness.seedProject({
          organizationId: workspace.id,
          name: `Project ${index}`,
          encryptedProjectKey: V1_WRAPPED_KEY,
        }),
      ),
    );
    return { workspace, projects };
  }

  async function grant(
    projectId: string,
    actor: SignedInActor,
    role: 'editor' | 'viewer' = 'editor',
  ) {
    await harness.seedProjectMember({
      projectId,
      userId: actor.user.id,
      role,
      encryptedProjectKey: V1_WRAPPED_KEY,
    });
  }

  function rotationBody(version: number, userIds: string[]) {
    return {
      expectedVersion: version,
      encryptedProjectKey: wrappedKeyWithVersions([version + 1, 1]),
      historyEntry: wrappedKeyWithVersions([version, version + 1]),
      grants: userIds.map((userId) => ({
        userId,
        encryptedProjectKey: wrappedKeyWithVersions([version + 1]),
      })),
    };
  }

  it('sets due flags on the exact projects when a workspace member is removed', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, editorB);
    await grant(projects[1]!.id, editorB);
    const member = await harness.prisma.member.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: workspace.id, userId: editorB.user.id } },
    });

    const res = await harness
      .request()
      .delete(`/api/workspaces/${workspace.id}/members/${member.id}`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.rotationDue.sort()).toEqual([projects[0]!.id, projects[1]!.id].sort());
    const stored = await harness.prisma.project.findMany({
      where: { organizationId: workspace.id },
      orderBy: { name: 'asc' },
    });
    expect(stored.map((project) => project.keyRotationDue)).toEqual([true, true, false]);
  });

  it('marks every project when the removed person was a workspace Admin', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, admin);
    const member = await harness.prisma.member.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: workspace.id, userId: admin.user.id } },
    });

    const res = await harness
      .request()
      .delete(`/api/workspaces/${workspace.id}/members/${member.id}`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.rotationDue.sort()).toEqual(projects.map((project) => project.id).sort());
    expect(
      await harness.prisma.project.count({
        where: { organizationId: workspace.id, keyRotationDue: true },
      }),
    ).toBe(projects.length);
  });

  it('marks the project when one project grant is removed', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[1]!.id, editorA);

    const res = await harness
      .request()
      .delete(`/api/projects/${projects[1]!.id}/members/${editorA.user.id}`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id);

    expect(res.status).toBe(200);
    expect(res.body.rotationDue).toEqual([projects[1]!.id]);
    const project = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projects[1]!.id },
    });
    expect(project.keyRotationDue).toBe(true);
  });

  it('marks every project the person could open when their account is erased', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, editorA);
    await grant(projects[2]!.id, editorA);

    await harness.app.get(UsersService).deleteAccount(editorA.user.id);

    const stored = await harness.prisma.project.findMany({
      where: { organizationId: workspace.id },
      orderBy: { name: 'asc' },
    });
    expect(stored.map((project) => project.keyRotationDue)).toEqual([true, false, true]);
  });

  it('exposes a rotation plan without pending grants, and the history chain', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, editorA);
    await grant(projects[0]!.id, editorB);
    await harness.seedProjectMember({
      projectId: projects[0]!.id,
      userId: pending.user.id,
      role: 'editor',
      encryptedProjectKey: null,
    });

    const plan = await harness
      .request()
      .get(`/api/projects/${projects[0]!.id}/rotation-plan`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id);
    expect(plan.status).toBe(200);
    expect(plan.body.keyVersion).toBe(1);
    expect(plan.body.grants.map((entry: { userId: string }) => entry.userId).sort()).toEqual(
      [editorA.user.id, editorB.user.id].sort(),
    );
    expect(plan.body.grants[0].publicKey).toBe('member-public-key');

    const history = await harness
      .request()
      .get(`/api/projects/${projects[0]!.id}/key-history`)
      .set('Cookie', editorA.cookie)
      .set('active-organization', workspace.id);
    expect(history.status).toBe(200);
    expect(history.body.entries).toEqual([]);
  });

  it('rotates all keys, the history entry and the version in one transaction', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, editorA);
    await grant(projects[0]!.id, editorB);
    await harness.seedProjectMember({
      projectId: projects[0]!.id,
      userId: pending.user.id,
      role: 'editor',
      encryptedProjectKey: null,
    });

    const res = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/rotate-key`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send(rotationBody(1, [editorA.user.id, editorB.user.id]));

    expect(res.status).toBe(200);
    expect(res.body.keyVersion).toBe(2);

    const project = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projects[0]!.id },
    });
    expect(project.keyVersion).toBe(2);
    expect(project.keyRotationDue).toBe(false);
    expect(project.encryptedProjectKey).toBe(wrappedKeyWithVersions([2, 1]));

    const grants = await harness.prisma.projectMember.findMany({
      where: { projectId: projects[0]!.id },
    });
    const byUser = new Map(grants.map((entry) => [entry.userId, entry]));
    expect(byUser.get(editorA.user.id)?.encryptedProjectKey).toBe(wrappedKeyWithVersions([2]));
    expect(byUser.get(editorB.user.id)?.encryptedProjectKey).toBe(wrappedKeyWithVersions([2]));
    expect(byUser.get(pending.user.id)?.encryptedProjectKey).toBeNull();

    const history = await harness.prisma.projectKeyHistory.findMany({
      where: { projectId: projects[0]!.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.version).toBe(1);
    expect(history[0]?.encryptedKey).toBe(wrappedKeyWithVersions([1, 2]));

    const chain = await harness
      .request()
      .get(`/api/projects/${projects[0]!.id}/key-history`)
      .set('Cookie', editorA.cookie)
      .set('active-organization', workspace.id);
    expect(chain.body).toMatchObject({
      keyVersion: 2,
      entries: [{ oldVersion: 1, newVersion: 2 }],
    });
  });

  it('refuses a wrong person set, a stale version, a bad header or a non-admin, changing nothing', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, editorA);
    const before = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projects[0]!.id },
    });

    const extra = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/rotate-key`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send(rotationBody(1, [editorA.user.id, editorB.user.id]));
    expect(extra.status).toBe(400);
    expect(extra.body.extraUserIds).toEqual([editorB.user.id]);

    const missing = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/rotate-key`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send(rotationBody(1, []));
    expect(missing.status).toBe(400);
    expect(missing.body.missingUserIds).toEqual([editorA.user.id]);

    const badHeader = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/rotate-key`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        ...rotationBody(1, [editorA.user.id]),
        encryptedProjectKey: wrappedKeyWithVersions([3, 1]),
      });
    expect(badHeader.status).toBe(400);

    const stale = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/rotate-key`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send(rotationBody(9, [editorA.user.id]));
    expect(stale.status).toBe(409);

    const projectAdmin = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/rotate-key`)
      .set('Cookie', editorA.cookie)
      .set('active-organization', workspace.id)
      .send(rotationBody(1, [editorA.user.id]));
    expect(projectAdmin.status).toBe(403);

    const after = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projects[0]!.id },
    });
    expect(after.keyVersion).toBe(before.keyVersion);
    expect(after.encryptedProjectKey).toBe(before.encryptedProjectKey);
    expect(await harness.prisma.projectKeyHistory.count()).toBe(0);
  });

  it('lets exactly one of two concurrent rotations win', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, editorA);

    const body = rotationBody(1, [editorA.user.id]);
    const [first, second] = await Promise.all([
      harness
        .request()
        .post(`/api/projects/${projects[0]!.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .send(body),
      harness
        .request()
        .post(`/api/projects/${projects[0]!.id}/rotate-key`)
        .set('Cookie', admin.cookie)
        .set('active-organization', workspace.id)
        .send(body),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
    const project = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projects[0]!.id },
    });
    expect(project.keyVersion).toBe(2);
    expect(await harness.prisma.projectKeyHistory.count()).toBe(1);
  });

  it('saves a normal payload at the board version and deletes the versioned object', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    const board = await harness.seedBoard({
      projectId: projects[0]!.id,
      title: 'Normal Save',
      encryptedBoardKey: V1_WRAPPED_KEY,
    });

    const res = await harness
      .request()
      .put(`/api/boards/${board.id}/payload`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .set('x-board-revision', '0')
      .set('Content-Type', 'application/octet-stream')
      .send(boardPayload(1));

    expect(res.status).toBe(200);
    expect(harness.storage.objects.has(`boards/${board.id}/v1.bin`)).toBe(true);
    expect(
      await harness.prisma.pendingBlobDeletion.count({
        where: { objectKey: `boards/${board.id}/v1.bin` },
      }),
    ).toBe(0);

    await harness
      .request()
      .delete(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id);
    await harness.purge.processDue();
    expect(harness.storage.objects.has(`boards/${board.id}/v1.bin`)).toBe(false);
  });

  it('re-keys an old board on save, queues the old object and keeps a public board untouched', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();

    const project = await harness.prisma.project.update({
      where: { id: projects[0]!.id },
      data: { keyVersion: 2 },
    });
    expect(project.keyVersion).toBe(2);

    const board = await harness.seedBoard({
      projectId: projects[0]!.id,
      title: 'Old Board',
      encryptedBoardKey: V1_WRAPPED_KEY,
      payload: boardPayload(1),
      keyVersion: 1,
    });

    const res = await harness
      .request()
      .put(`/api/boards/${board.id}/payload`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .set('x-board-revision', '0')
      .set('x-encrypted-board-key', wrappedKeyWithVersions([2, 2]))
      .set('Content-Type', 'application/octet-stream')
      .send(boardPayload(2));

    expect(res.status).toBe(200);
    const updated = await harness.prisma.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(updated.keyVersion).toBe(2);
    expect(updated.encryptedBoardKey).toBe(wrappedKeyWithVersions([2, 2]));
    expect(harness.storage.objects.has(`boards/${board.id}/v2.bin`)).toBe(true);
    expect(harness.storage.objects.has(`boards/${board.id}/v1.bin`)).toBe(true);
    expect(
      await harness.prisma.pendingBlobDeletion.findFirstOrThrow({
        where: { objectKey: `boards/${board.id}/v1.bin` },
      }),
    ).toMatchObject({ objectKey: `boards/${board.id}/v1.bin` });

    await harness.purge.processDue();
    expect(harness.storage.objects.has(`boards/${board.id}/v1.bin`)).toBe(false);

    const publicBoard = await harness.seedBoard({
      projectId: projects[0]!.id,
      title: 'Public Board',
      encryptedBoardKey: V1_WRAPPED_KEY,
      payload: boardPayload(1),
      keyVersion: 1,
      isPublic: true,
      publicShareToken: `token-${randomUUID()}`,
    });

    const rekeyPublic = await harness
      .request()
      .put(`/api/boards/${publicBoard.id}/payload`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .set('x-board-revision', '0')
      .set('x-encrypted-board-key', wrappedKeyWithVersions([2, 2]))
      .set('Content-Type', 'application/octet-stream')
      .send(boardPayload(2));
    expect(rekeyPublic.status).toBe(409);
    expect(rekeyPublic.body.code).toBe('PUBLIC_BOARD_REKEY');
    expect(
      (await harness.prisma.board.findUniqueOrThrow({ where: { id: publicBoard.id } })).keyVersion,
    ).toBe(1);
  });

  it('answers a stale payload version with KEY_ROTATED and leaves the old key and object intact', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await harness.prisma.project.update({
      where: { id: projects[0]!.id },
      data: { keyVersion: 2 },
    });
    const board = await harness.seedBoard({
      projectId: projects[0]!.id,
      title: 'Stale Board',
      encryptedBoardKey: V1_WRAPPED_KEY,
      payload: boardPayload(1),
      keyVersion: 1,
    });

    const res = await harness
      .request()
      .put(`/api/boards/${board.id}/payload`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .set('x-board-revision', '0')
      .set('Content-Type', 'application/octet-stream')
      .send(boardPayload(2));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'KEY_ROTATED',
      boardKeyVersion: 1,
      projectKeyVersion: 2,
    });
    expect(
      (await harness.prisma.board.findUniqueOrThrow({ where: { id: board.id } })).keyVersion,
    ).toBe(1);
    expect(harness.storage.objects.has(`boards/${board.id}/v1.bin`)).toBe(true);
  });

  it('keeps the old object and key when two re-key saves race', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await harness.prisma.project.update({
      where: { id: projects[0]!.id },
      data: { keyVersion: 2 },
    });
    const board = await harness.seedBoard({
      projectId: projects[0]!.id,
      title: 'Race Board',
      encryptedBoardKey: V1_WRAPPED_KEY,
      payload: boardPayload(1),
      keyVersion: 1,
    });

    // Each racer seals different bytes under its own board key, so the stored object can only
    // belong to the winner if the upload and the switch are serialised.
    const payloads = [
      Buffer.concat([boardPayload(2), Buffer.from('racer-one')]),
      Buffer.concat([boardPayload(2), Buffer.from('racer-two')]),
    ];
    const keys = [wrappedKeyWithVersions([2, 2]), wrappedKeyWithVersions([2, 2], 32)];
    const send = (index: number) =>
      harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .set('x-board-revision', '0')
        .set('x-encrypted-board-key', keys[index]!)
        .set('Content-Type', 'application/octet-stream')
        .send(payloads[index]);

    const [first, second] = await Promise.all([send(0), send(1)]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
    const winnerIndex = first.status === 200 ? 0 : 1;

    const updated = await harness.prisma.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(updated.keyVersion).toBe(2);
    expect(updated.encryptedBoardKey).toBe(keys[winnerIndex]);
    expect(harness.storage.objects.get(`boards/${board.id}/v2.bin`)).toEqual(payloads[winnerIndex]);
    expect(harness.storage.objects.has(`boards/${board.id}/v1.bin`)).toBe(true);
  });

  it('refuses a grant wrapped under a project key version that is no longer current', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await harness.prisma.project.update({
      where: { id: projects[0]!.id },
      data: { keyVersion: 2 },
    });

    const stale = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/members`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        userId: editorA.user.id,
        role: 'editor',
        encryptedProjectKey: wrappedKeyWithVersions([1]),
      });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_KEY_VERSION');

    const current = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/members`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        userId: editorA.user.id,
        role: 'editor',
        encryptedProjectKey: wrappedKeyWithVersions([2]),
      });
    expect(current.status).toBe(201);
  });

  it('refuses a rotation that lists the same person twice', async () => {
    const { workspace, projects } = await seedWorkspaceWithRoles();
    await grant(projects[0]!.id, editorA);
    const body = rotationBody(1, [editorA.user.id]);

    const response = await harness
      .request()
      .post(`/api/projects/${projects[0]!.id}/rotate-key`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({ ...body, grants: [...body.grants, ...body.grants] });
    expect(response.status).toBe(400);

    const project = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projects[0]!.id },
    });
    expect(project.keyVersion).toBe(1);
  });
});
