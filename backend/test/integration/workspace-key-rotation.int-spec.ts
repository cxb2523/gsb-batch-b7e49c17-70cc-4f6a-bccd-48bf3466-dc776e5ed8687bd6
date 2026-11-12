import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { boardPayload, wrappedKeyWithVersions } from './fixtures.js';

/** Batch 13c: Workspace key rotation on admin demotion, removal or erasure. */
describe('Workspace key rotation (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let adminA: SignedInActor;
  let adminB: SignedInActor;
  let editor: SignedInActor;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
  });

  beforeEach(async () => {
    await harness.resetDatabase();
    [owner, adminA, adminB, editor] = await Promise.all([
      harness.signIn('ws-rot-owner@local.com', 'WS Owner'),
      harness.signIn('ws-rot-admin-a@local.com', 'Admin A'),
      harness.signIn('ws-rot-admin-b@local.com', 'Admin B'),
      harness.signIn('ws-rot-editor@local.com', 'Editor'),
    ]);
    await harness.prisma.user.updateMany({
      where: { id: { in: [owner.user.id, adminA.user.id, adminB.user.id, editor.user.id] } },
      data: { publicKey: 'member-public-key' },
    });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  async function seedWorkspace(options: { projectCount?: number } = {}) {
    const workspace = await harness.seedWorkspace({ name: 'WS Rotation Workspace' });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
      encryptedOrgKey: wrappedKeyWithVersions([1]),
    });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: adminA.user.id,
      role: 'admin',
      encryptedOrgKey: wrappedKeyWithVersions([1]),
    });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: editor.user.id,
      role: 'editor',
    });

    const count = options.projectCount ?? 2;
    const projects = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        harness.seedProject({
          organizationId: workspace.id,
          name: `Project ${i}`,
          encryptedProjectKey: wrappedKeyWithVersions([1, 1]),
        }),
      ),
    );

    return { workspace, projects };
  }

  function workspaceRotationBody(
    expectedVersion: number,
    holderIds: string[],
    projects: Array<{ id: string; keyVersion: number }>,
  ) {
    const newVersion = expectedVersion + 1;
    return {
      expectedVersion,
      encryptedOrgKeys: holderIds.map((userId) => ({
        userId,
        encryptedOrgKey: wrappedKeyWithVersions([newVersion]),
      })),
      projects: projects.map((p) => ({
        id: p.id,
        projectKeyVersion: p.keyVersion,
        encryptedProjectKey: wrappedKeyWithVersions([p.keyVersion, newVersion]),
      })),
    };
  }

  describe('Due flags on events', () => {
    it('sets Organization.keyRotationDue and flags all projects when an Admin is demoted', async () => {
      const { workspace } = await seedWorkspace();
      const adminMember = await harness.prisma.member.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: workspace.id, userId: adminA.user.id } },
      });

      const res = await harness
        .request()
        .patch(`/api/workspaces/${workspace.id}/members/${adminMember.id}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'viewer' });

      expect(res.status).toBe(200);
      expect(res.body.encryptedOrgKey).toBeNull();

      const org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyRotationDue).toBe(true);

      const updatedProjects = await harness.prisma.project.findMany({
        where: { organizationId: workspace.id },
      });
      expect(updatedProjects.every((p) => p.keyRotationDue)).toBe(true);
    });

    it('sets Organization.keyRotationDue and flags all projects when an Admin is removed', async () => {
      const { workspace } = await seedWorkspace();
      const adminMember = await harness.prisma.member.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: workspace.id, userId: adminA.user.id } },
      });

      const res = await harness
        .request()
        .delete(`/api/workspaces/${workspace.id}/members/${adminMember.id}`)
        .set('Cookie', owner.cookie);

      expect(res.status).toBe(200);

      const org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyRotationDue).toBe(true);

      const updatedProjects = await harness.prisma.project.findMany({
        where: { organizationId: workspace.id },
      });
      expect(updatedProjects.every((p) => p.keyRotationDue)).toBe(true);
    });

    it('sets Organization.keyRotationDue when an Admin account is erased', async () => {
      const { workspace } = await seedWorkspace();

      const res = await harness
        .request()
        .post('/api/user/delete-account')
        .set('Cookie', adminA.cookie)
        .send({ confirmSoleDeletion: true });

      expect(res.status).toBe(200);

      const org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyRotationDue).toBe(true);
    });

    it('does NOT set Organization.keyRotationDue when an Editor is demoted or removed', async () => {
      const { workspace } = await seedWorkspace();
      const editorMember = await harness.prisma.member.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: workspace.id, userId: editor.user.id } },
      });

      const demoteRes = await harness
        .request()
        .patch(`/api/workspaces/${workspace.id}/members/${editorMember.id}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'viewer' });
      expect(demoteRes.status).toBe(200);

      let org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyRotationDue).toBe(false);

      const removeRes = await harness
        .request()
        .delete(`/api/workspaces/${workspace.id}/members/${editorMember.id}`)
        .set('Cookie', owner.cookie);
      expect(removeRes.status).toBe(200);

      org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyRotationDue).toBe(false);
    });
  });

  describe('Rotation plan (GET /api/workspaces/:id/rotation-plan)', () => {
    it('returns keyVersion, holders with public keys, and projects to an admin', async () => {
      const { workspace } = await seedWorkspace();

      const res = await harness
        .request()
        .get(`/api/workspaces/${workspace.id}/rotation-plan`)
        .set('Cookie', adminA.cookie);

      expect(res.status).toBe(200);
      expect(res.body.keyVersion).toBe(1);
      expect(res.body.holders).toEqual(
        expect.arrayContaining([
          { userId: owner.user.id, publicKey: 'member-public-key' },
          { userId: adminA.user.id, publicKey: 'member-public-key' },
        ]),
      );
      expect(res.body.holders).toHaveLength(2); // Editor is not a holder
      expect(res.body.projects).toHaveLength(2);
      expect(res.body.projects[0]).toHaveProperty('encryptedProjectKey');
    });

    it('refuses an editor from viewing the rotation plan', async () => {
      const { workspace } = await seedWorkspace();

      const res = await harness
        .request()
        .get(`/api/workspaces/${workspace.id}/rotation-plan`)
        .set('Cookie', editor.cookie);

      expect(res.status).toBe(403);
    });
  });

  describe('Re-key queue (GET /api/workspaces/:id/rekey-queue)', () => {
    it('lists boards behind their project key, counts public-link boards, skips the rest', async () => {
      const { workspace, projects } = await seedWorkspace({ projectCount: 1 });
      const project = projects[0]!;
      await harness.prisma.project.update({ where: { id: project.id }, data: { keyVersion: 2 } });

      const behindNewer = await harness.seedBoard({
        projectId: project.id,
        title: 'Newer',
        payload: boardPayload(1),
      });
      const behindOlder = await harness.seedBoard({
        projectId: project.id,
        title: 'Older',
        payload: boardPayload(1),
      });
      await harness.prisma.board.update({
        where: { id: behindOlder.id },
        data: { updatedAt: new Date('2020-01-01') },
      });
      await harness.seedBoard({
        projectId: project.id,
        title: 'Public',
        payload: boardPayload(1),
        isPublic: true,
        publicShareToken: 'rekey-public-token',
      });
      await harness.seedBoard({
        projectId: project.id,
        title: 'Current',
        payload: boardPayload(2),
        keyVersion: 2,
      });
      await harness.seedBoard({ projectId: project.id, title: 'Empty' });

      const res = await harness
        .request()
        .get(`/api/workspaces/${workspace.id}/rekey-queue`)
        .set('Cookie', adminA.cookie);

      expect(res.status).toBe(200);
      expect(res.body.skippedPublic).toBe(1);
      expect(res.body.boards.map((b: { boardId: string }) => b.boardId)).toEqual([
        behindOlder.id,
        behindNewer.id,
      ]);
      expect(res.body.boards[0]).toEqual({
        boardId: behindOlder.id,
        projectId: project.id,
        keyVersion: 1,
        projectKeyVersion: 2,
        revision: 0,
      });
    });

    it('is empty when nothing is behind, and refuses an editor', async () => {
      const { workspace } = await seedWorkspace();

      const empty = await harness
        .request()
        .get(`/api/workspaces/${workspace.id}/rekey-queue`)
        .set('Cookie', owner.cookie);
      expect(empty.body).toEqual({ boards: [], skippedPublic: 0 });

      const refused = await harness
        .request()
        .get(`/api/workspaces/${workspace.id}/rekey-queue`)
        .set('Cookie', editor.cookie);
      expect(refused.status).toBe(403);
    });
  });

  describe('Rotation execution (POST /api/workspaces/:id/rotate-key)', () => {
    it('successfully rotates workspace key, updating holders and project wraps atomically', async () => {
      const { workspace, projects } = await seedWorkspace();
      await harness.prisma.organization.update({
        where: { id: workspace.id },
        data: { keyRotationDue: true },
      });

      const body = workspaceRotationBody(1, [owner.user.id, adminA.user.id], projects);

      const res = await harness
        .request()
        .post(`/api/workspaces/${workspace.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.keyVersion).toBe(2);

      const org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyVersion).toBe(2);
      expect(org.keyRotationDue).toBe(false);

      const members = await harness.prisma.member.findMany({
        where: { organizationId: workspace.id, role: { in: ['owner', 'admin'] } },
      });
      expect(members.every((m) => m.encryptedOrgKey?.startsWith('AQAAAAIA'))).toBe(true); // v2 wrap

      const updatedProjects = await harness.prisma.project.findMany({
        where: { organizationId: workspace.id },
      });
      expect(updatedProjects.every((p) => p.encryptedProjectKey?.startsWith('AQAAAAEAAAAC'))).toBe(
        true,
      ); // v1 wrapped under v2
    });

    it('refuses rotation when holder set is missing an admin', async () => {
      const { workspace, projects } = await seedWorkspace();
      const body = workspaceRotationBody(1, [owner.user.id], projects); // missing adminA

      const res = await harness
        .request()
        .post(`/api/workspaces/${workspace.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.missingUserIds).toEqual([adminA.user.id]);

      const org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyVersion).toBe(1);
    });

    it('refuses rotation when holder set has extra users', async () => {
      const { workspace, projects } = await seedWorkspace();
      const body = workspaceRotationBody(
        1,
        [owner.user.id, adminA.user.id, editor.user.id],
        projects,
      );

      const res = await harness
        .request()
        .post(`/api/workspaces/${workspace.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.extraUserIds).toEqual([editor.user.id]);
    });

    it('refuses rotation when expectedVersion is stale', async () => {
      const { workspace, projects } = await seedWorkspace();
      const body = workspaceRotationBody(999, [owner.user.id, adminA.user.id], projects);

      const res = await harness
        .request()
        .post(`/api/workspaces/${workspace.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .send(body);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_KEY_VERSION');
    });

    it('refuses rotation when a project rotated meanwhile', async () => {
      const { workspace, projects } = await seedWorkspace();
      // Simulate project 0 rotated to v2 in the background
      await harness.prisma.project.update({
        where: { id: projects[0]!.id },
        data: { keyVersion: 2 },
      });

      const body = workspaceRotationBody(1, [owner.user.id, adminA.user.id], projects); // still says project 0 is v1

      const res = await harness
        .request()
        .post(`/api/workspaces/${workspace.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .send(body);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_KEY_VERSION');
    });

    it('refuses a rotation that leaves a project out, adds an unknown one or repeats one, changing nothing', async () => {
      const { workspace, projects } = await seedWorkspace({ projectCount: 3 });
      const holders = [owner.user.id, adminA.user.id];
      const send = (body: Record<string, unknown>) =>
        harness
          .request()
          .post(`/api/workspaces/${workspace.id}/rotate-key`)
          .set('Cookie', owner.cookie)
          .send(body);

      const missing = await send(workspaceRotationBody(1, holders, projects.slice(0, 2)));
      expect(missing.status).toBe(400);
      expect(missing.body.missingProjectIds).toEqual([projects[2]!.id]);

      const unknown = { id: 'not-a-project-of-this-workspace', keyVersion: 1 };
      const extra = await send(workspaceRotationBody(1, holders, [...projects, unknown]));
      expect(extra.status).toBe(400);
      expect(extra.body.extraProjectIds).toEqual([unknown.id]);

      const complete = workspaceRotationBody(1, holders, projects);
      const repeated = await send({
        ...complete,
        projects: [...complete.projects, complete.projects[0]],
      });
      expect(repeated.status).toBe(400);

      const org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyVersion).toBe(1);
      const stored = await harness.prisma.project.findMany({
        where: { organizationId: workspace.id },
      });
      expect(
        stored.every((project) => project.encryptedProjectKey === wrappedKeyWithVersions([1, 1])),
      ).toBe(true);
    });

    it('refuses a new project wrapped under a workspace key version that is no longer current', async () => {
      const { workspace } = await seedWorkspace();
      await harness.prisma.organization.update({
        where: { id: workspace.id },
        data: { keyVersion: 2 },
      });
      const create = (workspaceVersion: number) =>
        harness
          .request()
          .post('/api/projects')
          .set('Cookie', owner.cookie)
          .set('active-organization', workspace.id)
          .send({
            id: crypto.randomUUID(),
            name: 'Late project',
            encryptedProjectKey: wrappedKeyWithVersions([1, workspaceVersion]),
            creatorEncryptedProjectKey: wrappedKeyWithVersions([1]),
          });

      const stale = await create(1);
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_KEY_VERSION');
      expect((await create(2)).status).toBe(201);
    });

    it('refuses rotation with bad header versions', async () => {
      const { workspace, projects } = await seedWorkspace();
      const body = workspaceRotationBody(1, [owner.user.id, adminA.user.id], projects);
      body.encryptedOrgKeys[0]!.encryptedOrgKey = wrappedKeyWithVersions([99]); // wrong version

      const res = await harness
        .request()
        .post(`/api/workspaces/${workspace.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .send(body);

      expect(res.status).toBe(400);
    });

    it('refuses rotation when caller is not an administrator', async () => {
      const { workspace, projects } = await seedWorkspace();
      const body = workspaceRotationBody(1, [owner.user.id, adminA.user.id], projects);

      const res = await harness
        .request()
        .post(`/api/workspaces/${workspace.id}/rotate-key`)
        .set('Cookie', editor.cookie)
        .send(body);

      expect(res.status).toBe(403);
    });

    it('resolves concurrent workspace rotations with exactly one winner', async () => {
      const { workspace, projects } = await seedWorkspace();
      const bodyA = workspaceRotationBody(1, [owner.user.id, adminA.user.id], projects);
      const bodyB = workspaceRotationBody(1, [owner.user.id, adminA.user.id], projects);

      const [resA, resB] = await Promise.all([
        harness
          .request()
          .post(`/api/workspaces/${workspace.id}/rotate-key`)
          .set('Cookie', owner.cookie)
          .send(bodyA),
        harness
          .request()
          .post(`/api/workspaces/${workspace.id}/rotate-key`)
          .set('Cookie', adminA.cookie)
          .send(bodyB),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      const org = await harness.prisma.organization.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(org.keyVersion).toBe(2);
    });
  });

  describe('Refusals & interactions', () => {
    it('refuses project rotation while workspace rotation is pending', async () => {
      const { workspace, projects } = await seedWorkspace();
      await harness.prisma.organization.update({
        where: { id: workspace.id },
        data: { keyRotationDue: true },
      });

      const body = {
        expectedVersion: 1,
        encryptedProjectKey: wrappedKeyWithVersions([2, 1]),
        historyEntry: wrappedKeyWithVersions([1, 2]),
        grants: [],
      };

      const res = await harness
        .request()
        .post(`/api/projects/${projects[0]!.id}/rotate-key`)
        .set('Cookie', owner.cookie)
        .send(body);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WORKSPACE_ROTATION_PENDING');
    });

    it('refuses promotion when supplied wrapped workspace key version is stale', async () => {
      const { workspace } = await seedWorkspace();
      // Workspace is at keyVersion 2
      await harness.prisma.organization.update({
        where: { id: workspace.id },
        data: { keyVersion: 2 },
      });

      const editorMember = await harness.prisma.member.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: workspace.id, userId: editor.user.id } },
      });

      // Promoting with an encryptedOrgKey that has version 1 (stale)
      const res = await harness
        .request()
        .patch(`/api/workspaces/${workspace.id}/members/${editorMember.id}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'admin', encryptedOrgKey: wrappedKeyWithVersions([1]) });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_KEY_VERSION');
    });
  });
});
