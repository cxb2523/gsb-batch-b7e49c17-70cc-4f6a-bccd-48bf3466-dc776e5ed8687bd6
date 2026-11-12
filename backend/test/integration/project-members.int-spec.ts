import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';

/**
 * R6 over the real database: the member listing shows the people who can read a project, where
 * their access comes from, and whether a pending grant still needs its key - never the key.
 */
describe('Effective project members and the caller key status (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let admin: SignedInActor;
  let granted: SignedInActor;
  let pending: SignedInActor;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();

    [owner, admin, granted, pending] = await Promise.all([
      harness.signIn('effective-owner@local.com', 'Workspace Owner'),
      harness.signIn('effective-admin@local.com', 'Workspace Admin'),
      harness.signIn('effective-granted@local.com', 'Granted Editor'),
      harness.signIn('effective-pending@local.com', 'Pending Editor'),
    ]);

    const workspace = await harness.seedWorkspace({ name: 'Effective Access' });
    workspaceId = workspace.id;

    await Promise.all([
      harness.seedMember({ organizationId: workspaceId, userId: owner.user.id, role: 'owner' }),
      harness.seedMember({ organizationId: workspaceId, userId: admin.user.id, role: 'admin' }),
      harness.seedMember({ organizationId: workspaceId, userId: granted.user.id, role: 'editor' }),
      harness.seedMember({ organizationId: workspaceId, userId: pending.user.id, role: 'editor' }),
    ]);

    const project = await harness.seedProject({
      organizationId: workspaceId,
      name: 'Effective Project',
      encryptedProjectKey: 'workspace-wrapped-project-key',
    });
    projectId = project.id;

    // An explicit grant for the admin must be folded into the single workspace entry.
    await Promise.all([
      harness.seedProjectMember({
        projectId,
        userId: admin.user.id,
        role: 'viewer',
        encryptedProjectKey: 'admin-explicit-grant-key',
      }),
      harness.seedProjectMember({
        projectId,
        userId: granted.user.id,
        role: 'editor',
        encryptedProjectKey: 'granted-wrapped-project-key',
      }),
      harness.seedProjectMember({
        projectId,
        userId: pending.user.id,
        role: 'viewer',
        encryptedProjectKey: null,
      }),
    ]);
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const list = (actor: SignedInActor, query = '') =>
    harness
      .request()
      .get(`/api/projects/${projectId}/members${query}`)
      .set('Cookie', actor.cookie)
      .set('active-organization', workspaceId);

  it('lists workspace administrators once, source-tagged, alongside granted and pending grants', async () => {
    const res = await list(owner);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 4 });
    expect(res.body.items).toHaveLength(4);

    const byUser = new Map<string, unknown>();
    for (const item of res.body.items) {
      byUser.set(item.userId, item);
    }

    expect(byUser.get(owner.user.id)).toMatchObject({
      role: 'admin',
      source: 'workspace',
      keyStatus: 'granted',
    });
    expect(byUser.get(admin.user.id)).toMatchObject({
      role: 'admin',
      source: 'workspace',
      keyStatus: 'granted',
    });
    expect(byUser.get(granted.user.id)).toMatchObject({
      role: 'editor',
      source: 'project',
      keyStatus: 'granted',
    });
    expect(byUser.get(pending.user.id)).toMatchObject({
      role: 'viewer',
      source: 'project',
      keyStatus: 'pending',
    });

    // Exactly once each, and the wrapped keys never leave the database.
    expect(res.body.items).toHaveLength(byUser.size);
    expect(JSON.stringify(res.body)).not.toContain('wrapped-project-key');
    expect(JSON.stringify(res.body)).not.toContain('explicit-grant-key');
    expect(JSON.stringify(res.body)).not.toContain('encryptedProjectKey');
  });

  it('shows the same effective list to a project member', async () => {
    const res = await list(granted);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(4);
  });

  it('reports the caller own key status on the project list', async () => {
    const readProjects = (actor: SignedInActor) =>
      harness
        .request()
        .get('/api/projects?page=1&limit=20')
        .set('Cookie', actor.cookie)
        .set('active-organization', workspaceId);

    const [ownerRes, grantedRes, pendingRes] = await Promise.all([
      readProjects(owner),
      readProjects(granted),
      readProjects(pending),
    ]);

    for (const res of [ownerRes, grantedRes, pendingRes]) {
      expect(res.status).toBe(200);
    }

    const statusFor = (body: { items: Array<{ id: string; keyStatus: string }> }) =>
      body.items.find((project) => project.id === projectId)?.keyStatus;

    expect(statusFor(ownerRes.body)).toBe('granted');
    expect(statusFor(grantedRes.body)).toBe('granted');
    expect(statusFor(pendingRes.body)).toBe('pending');

    // The pending grant is the only project a non-admin sees, and it carries no key on the board.
    expect(pendingRes.body.items).toHaveLength(1);
    expect(JSON.stringify(pendingRes.body)).not.toContain('granted-wrapped-project-key');
  });

  it('names the caller on the grant it lists, so the browser can find its own project key', async () => {
    const res = await harness
      .request()
      .get('/api/projects?page=1&limit=20')
      .set('Cookie', granted.cookie)
      .set('active-organization', workspaceId);

    const project = res.body.items.find((item: { id: string }) => item.id === projectId);
    expect(project.members).toHaveLength(1);
    expect(project.members[0]).toMatchObject({
      userId: granted.user.id,
      role: 'editor',
    });
    expect(typeof project.members[0].encryptedProjectKey).toBe('string');
  });
});
