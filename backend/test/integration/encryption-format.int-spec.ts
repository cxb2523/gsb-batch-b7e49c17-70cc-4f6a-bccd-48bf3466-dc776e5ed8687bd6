import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { V1_BOARD_PAYLOAD, V1_WRAPPED_KEY } from './fixtures.js';

/** E4 and R4 at the API boundary: v1 envelopes, key versions, and nothing unbound. */
describe('Encrypted format and key versions (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();
    owner = await harness.signIn('format-owner@local.com', 'Format Owner');
  });

  beforeEach(async () => {
    await harness.resetDatabase();
    owner = await harness.signIn('format-owner@local.com', 'Format Owner');
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const badFirstByte = () => {
    const bytes = Buffer.from(V1_WRAPPED_KEY, 'base64url');
    bytes[0] = 0x02;
    return bytes.toString('base64url');
  };
  const tooShort = () => Buffer.from([0x01, 0x02, 0x03]).toString('base64url');

  async function seedWorkspace(encryptedOrgKey = V1_WRAPPED_KEY) {
    const workspace = await harness.seedWorkspace({ name: 'Format Workspace' });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
      encryptedOrgKey,
    });
    return workspace;
  }

  async function seedProject(organizationId: string, keyVersion = 1) {
    return harness
      .seedProject({
        organizationId,
        name: 'Format Project',
        encryptedProjectKey: V1_WRAPPED_KEY,
      })
      .then((project) =>
        harness.prisma.project.update({
          where: { id: project.id },
          data: { keyVersion },
        }),
      );
  }

  it('starts every new organization, project and board at key version 1', async () => {
    const createRes = await harness
      .request()
      .post('/api/workspaces')
      .set('Cookie', owner.cookie)
      .send({
        id: randomUUID(),
        name: 'Versioned Workspace',
        encryptedOrgKey: V1_WRAPPED_KEY,
        project: {
          id: randomUUID(),
          name: 'Versioned Project',
          encryptedProjectKey: V1_WRAPPED_KEY,
          creatorEncryptedProjectKey: V1_WRAPPED_KEY,
        },
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.keyVersion).toBe(1);

    const project = await harness.prisma.project.findFirstOrThrow({
      where: { organizationId: createRes.body.id },
    });
    expect(project.keyVersion).toBe(1);

    const boardRes = await harness
      .request()
      .post('/api/boards')
      .set('Cookie', owner.cookie)
      .set('active-organization', createRes.body.id)
      .send({
        id: randomUUID(),
        projectId: project.id,
        title: 'Versioned Board',
        encryptedBoardKey: V1_WRAPPED_KEY,
        projectKeyVersion: 1,
      });
    expect(boardRes.status).toBe(201);
    expect(boardRes.body.keyVersion).toBe(1);
  });

  it('rejects a v1 wrapped key with a wrong format byte or a too-short body in every DTO', async () => {
    const workspace = await seedWorkspace();

    const project = await harness
      .request()
      .post('/api/projects')
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        id: randomUUID(),
        name: 'Bad Project',
        encryptedProjectKey: badFirstByte(),
        creatorEncryptedProjectKey: V1_WRAPPED_KEY,
      });
    expect(project.status).toBe(400);
    expect(await harness.prisma.project.count({ where: { organizationId: workspace.id } })).toBe(0);

    const shortProject = await harness
      .request()
      .post('/api/projects')
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        id: randomUUID(),
        name: 'Short Project',
        encryptedProjectKey: tooShort(),
        creatorEncryptedProjectKey: V1_WRAPPED_KEY,
      });
    expect(shortProject.status).toBe(400);

    const seeded = await seedProject(workspace.id);
    const target = await harness.signIn('format-target@local.com', 'Target');
    await harness.seedMember({
      organizationId: workspace.id,
      userId: target.user.id,
      role: 'editor',
    });

    const grant = await harness
      .request()
      .post(`/api/projects/${seeded.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: target.user.id, role: 'viewer', encryptedProjectKey: badFirstByte() });
    expect(grant.status).toBe(400);
    expect(
      await harness.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: seeded.id, userId: target.user.id } },
      }),
    ).toBeNull();

    const board = await harness
      .request()
      .post('/api/boards')
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        id: randomUUID(),
        projectId: seeded.id,
        title: 'Bad Board',
        encryptedBoardKey: badFirstByte(),
        projectKeyVersion: 1,
      });
    expect(board.status).toBe(400);
    expect(await harness.prisma.board.count({ where: { projectId: seeded.id } })).toBe(0);
  });

  it('rejects a workspace whose wrapped key is not v1, creating nothing', async () => {
    const before = await harness.prisma.organization.count();
    const res = await harness
      .request()
      .post('/api/workspaces')
      .set('Cookie', owner.cookie)
      .send({
        id: randomUUID(),
        name: 'Bad Workspace',
        encryptedOrgKey: badFirstByte(),
        project: {
          id: randomUUID(),
          name: 'Bad First Project',
          encryptedProjectKey: V1_WRAPPED_KEY,
          creatorEncryptedProjectKey: V1_WRAPPED_KEY,
        },
      });

    expect(res.status).toBe(400);
    expect(await harness.prisma.organization.count()).toBe(before);
  });

  it('rejects a board payload that is not v1 and leaves the board untouched', async () => {
    const workspace = await seedWorkspace();
    const project = await seedProject(workspace.id);
    const board = await harness.seedBoard({
      projectId: project.id,
      title: 'Payload Board',
      encryptedBoardKey: V1_WRAPPED_KEY,
    });

    const unversioned = Buffer.from('not-a-v1-payload-at-all-not-a-v1-payload');
    const res = await harness
      .request()
      .put(`/api/boards/${board.id}/payload`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .set('x-board-revision', '0')
      .set('Content-Type', 'application/octet-stream')
      .send(unversioned);

    expect(res.status).toBe(400);
    const stored = await harness.prisma.board.findUniqueOrThrow({ where: { id: board.id } });
    expect(stored.hasPayload).toBe(false);
    expect(harness.storage.objects.has(`boards/${board.id}/v1.bin`)).toBe(false);

    const truncated = V1_BOARD_PAYLOAD.subarray(0, 20);
    const shortRes = await harness
      .request()
      .put(`/api/boards/${board.id}/payload`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .set('x-board-revision', '0')
      .set('Content-Type', 'application/octet-stream')
      .send(truncated);
    expect(shortRes.status).toBe(400);
  });

  it('answers a stale board key version with 409 and creates nothing', async () => {
    const workspace = await seedWorkspace();
    const project = await seedProject(workspace.id, 2);

    const res = await harness
      .request()
      .post('/api/boards')
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        id: randomUUID(),
        projectId: project.id,
        title: 'Stale Board',
        encryptedBoardKey: V1_WRAPPED_KEY,
        projectKeyVersion: 1,
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/changed/i);
    expect(await harness.prisma.board.count({ where: { projectId: project.id } })).toBe(0);

    const current = await harness
      .request()
      .post('/api/boards')
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({
        id: randomUUID(),
        projectId: project.id,
        title: 'Current Board',
        encryptedBoardKey: V1_WRAPPED_KEY,
        projectKeyVersion: 2,
      });
    expect(current.status).toBe(201);
    expect(current.body.keyVersion).toBe(2);
  });

  it('keeps key versions at or above 1 in the database', async () => {
    const workspace = await seedWorkspace();
    const project = await seedProject(workspace.id);

    await expect(
      harness.prisma.project.update({ where: { id: project.id }, data: { keyVersion: 0 } }),
    ).rejects.toThrow();
  });

  it('returns only id and keyVersion as the new public fields', async () => {
    const workspace = await seedWorkspace();
    const project = await seedProject(workspace.id);
    const board = await harness.seedBoard({
      projectId: project.id,
      title: 'Public Board',
      encryptedBoardKey: V1_WRAPPED_KEY,
      isPublic: true,
      publicShareToken: `token-${randomUUID()}`,
    });

    const res = await harness.request().get(`/api/public/boards/${board.publicShareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(board.id);
    expect(res.body.keyVersion).toBe(1);
    expect(Object.keys(res.body).sort()).toEqual(
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
});
