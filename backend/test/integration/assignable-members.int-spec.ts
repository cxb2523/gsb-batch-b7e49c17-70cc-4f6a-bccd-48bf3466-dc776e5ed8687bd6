import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { V1_WRAPPED_KEY } from './fixtures.js';

/**
 * The picker behind "Assign member": a Project Admin who is only an Editor in the workspace cannot
 * read the workspace member list, so the project serves the people who could still be added.
 */
describe('Assignable project members (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let admin: SignedInActor;
  let projectAdmin: SignedInActor;
  let projectEditor: SignedInActor;
  let pending: SignedInActor;
  let freeEditor: SignedInActor;
  let freeViewer: SignedInActor;
  let outsider: SignedInActor;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();

    [owner, admin, projectAdmin, projectEditor, pending, freeEditor, freeViewer, outsider] =
      await Promise.all([
        harness.signIn('assignable-owner@local.com', 'Olive Owner'),
        harness.signIn('assignable-admin@local.com', 'Adam Admin'),
        harness.signIn('assignable-padmin@local.com', 'Pia Projectadmin'),
        harness.signIn('assignable-peditor@local.com', 'Pete Projecteditor'),
        harness.signIn('assignable-pending@local.com', 'Penny Pending'),
        harness.signIn('assignable-free-editor@local.com', 'Eve Freeeditor'),
        harness.signIn('assignable-free-viewer@local.com', 'Victor Freeviewer'),
        harness.signIn('assignable-outsider@local.com', 'Otto Outsider'),
      ]);

    const workspace = await harness.seedWorkspace({ name: 'Assignable' });
    workspaceId = workspace.id;
    const members: Array<[SignedInActor, 'owner' | 'admin' | 'editor' | 'viewer']> = [
      [owner, 'owner'],
      [admin, 'admin'],
      [projectAdmin, 'editor'],
      [projectEditor, 'editor'],
      [pending, 'editor'],
      [freeEditor, 'editor'],
      [freeViewer, 'viewer'],
    ];
    await Promise.all(
      members.map(([actor, role]) =>
        harness.seedMember({ organizationId: workspaceId, userId: actor.user.id, role }),
      ),
    );

    const project = await harness.seedProject({ organizationId: workspaceId, name: 'Roadmap' });
    projectId = project.id;
    await harness.seedProjectMember({
      projectId,
      userId: projectAdmin.user.id,
      role: 'admin',
      encryptedProjectKey: V1_WRAPPED_KEY,
    });
    await harness.seedProjectMember({
      projectId,
      userId: projectEditor.user.id,
      role: 'editor',
      encryptedProjectKey: V1_WRAPPED_KEY,
    });
    await harness.seedProjectMember({
      projectId,
      userId: pending.user.id,
      role: 'editor',
      encryptedProjectKey: null,
    });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const assignable = (actor: SignedInActor, query = '') =>
    harness
      .request()
      .get(`/api/projects/${projectId}/assignable-members${query}`)
      .set('Cookie', actor.cookie);

  it('lists only people with no grant yet, to a Project Admin who is an Editor in the workspace', async () => {
    const res = await assignable(projectAdmin);

    expect(res.status).toBe(200);
    const userIds = res.body.items.map((item: { userId: string }) => item.userId).sort();
    expect(userIds).toEqual([freeEditor.user.id, freeViewer.user.id].sort());
    expect(res.body.pagination).toMatchObject({ page: 1, total: 2, hasNextPage: false });
  });

  it('is the same list for an Owner and an Admin, who are never in it themselves', async () => {
    const responses = await Promise.all([owner, admin].map((actor) => assignable(actor)));

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    }
  });

  it('gives a name and an email and nothing else about each person', async () => {
    const res = await assignable(projectAdmin);

    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['email', 'name', 'userId']);
    }
    expect(res.body.items.map((item: { name: string }) => item.name)).toEqual([
      'Eve Freeeditor',
      'Victor Freeviewer',
    ]);
  });

  it('drops a person from the list once they have a grant, pending ones included', async () => {
    await harness.seedProjectMember({
      projectId,
      userId: freeViewer.user.id,
      role: 'viewer',
      encryptedProjectKey: null,
    });

    const res = await assignable(projectAdmin);

    expect(res.body.items.map((item: { userId: string }) => item.userId)).toEqual([
      freeEditor.user.id,
    ]);

    await harness.prisma.projectMember.deleteMany({ where: { userId: freeViewer.user.id } });
  });

  it('refuses a project editor, a workspace member with no grant, and someone outside the workspace', async () => {
    expect((await assignable(projectEditor)).status).toBe(403);
    expect((await assignable(freeEditor)).status).toBe(403);
    expect((await assignable(outsider)).status).toBe(403);
  });
});
