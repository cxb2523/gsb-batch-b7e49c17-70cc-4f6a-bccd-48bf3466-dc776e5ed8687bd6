import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { V1_WRAPPED_KEY } from './fixtures.js';

/**
 * R3 and C4: who may create a workspace, and the workspace is created with its keys in one
 * transaction. The library's own create route is disabled.
 */
describe('Workspace creation rule (Integration)', () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
  });

  beforeEach(async () => {
    await harness.resetDatabase();
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const bodyFor = (name: string) => ({
    id: randomUUID(),
    name,
    encryptedOrgKey: V1_WRAPPED_KEY,
    project: {
      id: randomUUID(),
      name: `${name} Project`,
      encryptedProjectKey: V1_WRAPPED_KEY,
      creatorEncryptedProjectKey: V1_WRAPPED_KEY,
    },
  });

  const createWorkspace = (actor: SignedInActor, name: string) =>
    harness.request().post('/api/workspaces').set('Cookie', actor.cookie).send(bodyFor(name));

  async function seedRole(actor: SignedInActor, role: 'owner' | 'admin' | 'editor' | 'viewer') {
    const workspace = await harness.seedWorkspace({ name: `Existing ${role}` });
    await harness.seedMember({ organizationId: workspace.id, userId: actor.user.id, role });
    return workspace;
  }

  it('workspace creation: a brand-new user creates the workspace, its Owner and first project with keys', async () => {
    const user = await harness.signIn('creator-new@local.com', 'New User');

    const res = await createWorkspace(user, 'First Workspace');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'First Workspace' });
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.slug).toBe('string');

    const organization = await harness.prisma.organization.findFirstOrThrow();
    const membership = await harness.prisma.member.findFirstOrThrow({
      where: { organizationId: organization.id, userId: user.user.id },
    });
    expect(membership.role).toBe('owner');
    expect(membership.encryptedOrgKey).toBe(V1_WRAPPED_KEY);

    const project = await harness.prisma.project.findFirstOrThrow({
      where: { organizationId: organization.id },
    });
    expect(project.encryptedProjectKey).toBe(V1_WRAPPED_KEY);

    const grant = await harness.prisma.projectMember.findFirstOrThrow({
      where: { projectId: project.id, userId: user.user.id },
    });
    expect(grant.role).toBe('admin');
    expect(grant.encryptedProjectKey).toBe(V1_WRAPPED_KEY);
  });

  it('workspace creation: an owner or admin elsewhere can create another workspace', async () => {
    const owner = await harness.signIn('creator-owner@local.com', 'Owner Elsewhere');
    await seedRole(owner, 'owner');
    const admin = await harness.signIn('creator-admin@local.com', 'Admin Elsewhere');
    await seedRole(admin, 'admin');

    expect((await createWorkspace(owner, 'Owner Second')).status).toBe(201);
    expect((await createWorkspace(admin, 'Admin Second')).status).toBe(201);
    expect(await harness.prisma.organization.count()).toBe(4);
  });

  it('workspace creation: an editor-only or viewer-only user is refused and no workspace is written', async () => {
    const editor = await harness.signIn('creator-editor@local.com', 'Editor Elsewhere');
    await seedRole(editor, 'editor');
    const viewer = await harness.signIn('creator-viewer@local.com', 'Viewer Elsewhere');
    await seedRole(viewer, 'viewer');
    const before = await harness.prisma.organization.count();

    const editorRes = await createWorkspace(editor, 'Forbidden Editor Workspace');
    const viewerRes = await createWorkspace(viewer, 'Forbidden Viewer Workspace');

    expect(editorRes.status).toBe(403);
    expect(String(editorRes.body?.message)).toContain(
      'Only workspace owners and admins can create more workspaces',
    );
    expect(viewerRes.status).toBe(403);
    expect(await harness.prisma.organization.count()).toBe(before);
  });

  it('workspace creation: the library create route is disabled', async () => {
    const user = await harness.signIn('creator-library@local.com', 'Library Route');

    const res = await harness
      .request()
      .post('/api/auth/organization/create')
      .set('Cookie', user.cookie)
      .send({
        name: 'Library Workspace',
        slug: `library-${randomUUID()}`,
      });

    expect(res.status).toBe(404);
    expect(await harness.prisma.organization.count()).toBe(0);
  });

  it('workspace creation: a failure after the organization write leaves nothing behind', async () => {
    const user = await harness.signIn('creator-atomic@local.com', 'Atomic Creator');

    // Make the project insert fail inside the real transaction, after the organization row was
    // written. The transaction must roll the organization and membership back too.
    await harness.prisma.$executeRawUnsafe(`
      CREATE FUNCTION canvhq_fail_project_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'simulated project insert failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await harness.prisma.$executeRawUnsafe(`
      CREATE TRIGGER canvhq_fail_project_insert
      BEFORE INSERT ON "project"
      FOR EACH ROW EXECUTE FUNCTION canvhq_fail_project_insert();
    `);

    try {
      const res = await createWorkspace(user, 'Atomic Workspace');
      expect(res.status).toBe(500);
    } finally {
      await harness.prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS canvhq_fail_project_insert ON "project"',
      );
      await harness.prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS canvhq_fail_project_insert()',
      );
    }

    expect(await harness.prisma.organization.count()).toBe(0);
    expect(await harness.prisma.member.count()).toBe(0);
    expect(await harness.prisma.project.count()).toBe(0);
  });

  it('workspace creation: all three keys are required', async () => {
    const user = await harness.signIn('creator-keys@local.com', 'Key Checker');
    const full = bodyFor('Key Workspace');

    const missingOrg = await harness
      .request()
      .post('/api/workspaces')
      .set('Cookie', user.cookie)
      .send({ ...full, encryptedOrgKey: undefined });
    const missingProject = await harness
      .request()
      .post('/api/workspaces')
      .set('Cookie', user.cookie)
      .send({
        ...full,
        project: { ...full.project, encryptedProjectKey: undefined },
      });
    const missingCreator = await harness
      .request()
      .post('/api/workspaces')
      .set('Cookie', user.cookie)
      .send({
        ...full,
        project: { ...full.project, creatorEncryptedProjectKey: undefined },
      });

    expect(missingOrg.status).toBe(400);
    expect(missingProject.status).toBe(400);
    expect(missingCreator.status).toBe(400);
    expect(await harness.prisma.organization.count()).toBe(0);
  });
});
