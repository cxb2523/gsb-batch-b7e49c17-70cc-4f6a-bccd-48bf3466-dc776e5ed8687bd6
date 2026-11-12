import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { v1WrappedKey } from './fixtures.js';

/**
 * H5: adding a project member is insert-only. A project Admin may not replace another member's
 * role or wrapped key through the add route; the only permitted write is filling a missing key.
 */
describe('Project grant writes (Integration)', () => {
  let harness: IntegrationHarness;
  let projectAdmin: SignedInActor;
  let target: SignedInActor;
  let partial: SignedInActor;
  let keyed: SignedInActor;
  let projectId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();

    projectAdmin = await harness.signIn('grant-admin@local.com', 'Project Admin');
    target = await harness.signIn('grant-target@local.com', 'Target');
    partial = await harness.signIn('grant-partial@local.com', 'Partial Grant');
    keyed = await harness.signIn('grant-keyed@local.com', 'Keyed Grant');

    const workspace = await harness.seedWorkspace({ name: 'Grant Workspace' });
    await Promise.all(
      [projectAdmin, target, partial, keyed].map((actor) =>
        harness.seedMember({
          organizationId: workspace.id,
          userId: actor.user.id,
          role: 'editor',
        }),
      ),
    );

    const project = await harness.seedProject({
      organizationId: workspace.id,
      name: 'Grant Project',
    });
    projectId = project.id;

    await harness.seedProjectMember({
      projectId,
      userId: projectAdmin.user.id,
      role: 'admin',
    });
    await harness.seedProjectMember({
      projectId,
      userId: partial.user.id,
      role: 'editor',
      encryptedProjectKey: null,
    });
    await harness.seedProjectMember({
      projectId,
      userId: keyed.user.id,
      role: 'editor',
      encryptedProjectKey: 'their-existing-key',
    });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const addGrant = (userId: string, role = 'viewer', encryptedProjectKey?: string) =>
    harness
      .request()
      .post(`/api/projects/${projectId}/members`)
      .set('Cookie', projectAdmin.cookie)
      .send({
        userId,
        role,
        ...(encryptedProjectKey ? { encryptedProjectKey } : {}),
      });

  it('grant: adds a new member once', async () => {
    const res = await addGrant(target.user.id, 'viewer', v1WrappedKey('for-target'));

    expect(res.status).toBe(201);
    const grant = await harness.prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId: target.user.id } },
    });
    expect(grant.role).toBe('viewer');
    expect(grant.encryptedProjectKey).toBe(v1WrappedKey('for-target'));
  });

  it('grant: refuses to add somebody who already has one, without changing their row', async () => {
    const res = await addGrant(keyed.user.id, 'admin', v1WrappedKey('attacker-key'));

    expect(res.status).toBe(409);
    const grant = await harness.prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId: keyed.user.id } },
    });
    expect(grant.role).toBe('editor');
    expect(grant.encryptedProjectKey).toBe('their-existing-key');
  });

  it('grant: fills a missing key once without changing the role', async () => {
    const res = await addGrant(partial.user.id, 'admin', v1WrappedKey('first-key'));

    expect(res.status).toBe(201);
    const grant = await harness.prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId: partial.user.id } },
    });
    expect(grant.role).toBe('editor');
    expect(grant.encryptedProjectKey).toBe(v1WrappedKey('first-key'));

    const second = await addGrant(partial.user.id, 'admin', v1WrappedKey('replacement-key'));
    expect(second.status).toBe(409);
    const unchanged = await harness.prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId: partial.user.id } },
    });
    expect(unchanged.encryptedProjectKey).toBe(v1WrappedKey('first-key'));
  });

  it('grant: refuses a new grant with no wrapped key and creates nothing', async () => {
    const keyless = await harness.signIn('grant-keyless@local.com', 'Keyless');
    const project = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    await harness.seedMember({
      organizationId: project.organizationId,
      userId: keyless.user.id,
      role: 'editor',
    });

    const res = await harness
      .request()
      .post(`/api/projects/${projectId}/members`)
      .set('Cookie', projectAdmin.cookie)
      .send({ userId: keyless.user.id, role: 'viewer' });

    expect(res.status).toBe(400);
    expect(
      await harness.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: keyless.user.id } },
      }),
    ).toBeNull();
  });

  it('grant: two concurrent completions have exactly one winner', async () => {
    const racer = await harness.signIn('grant-racer@local.com', 'Racer');
    const project = await harness.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    await harness.seedMember({
      organizationId: project.organizationId,
      userId: racer.user.id,
      role: 'editor',
    });
    await harness.seedProjectMember({
      projectId,
      userId: racer.user.id,
      role: 'editor',
      encryptedProjectKey: null,
    });

    const [first, second] = await Promise.all([
      addGrant(racer.user.id, 'editor', v1WrappedKey('racer-key-a')),
      addGrant(racer.user.id, 'editor', v1WrappedKey('racer-key-b')),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([201, 409]);
    const winner = first.status === 201 ? v1WrappedKey('racer-key-a') : v1WrappedKey('racer-key-b');
    const stored = await harness.prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId: racer.user.id } },
    });
    expect(stored.encryptedProjectKey).toBe(winner);
  });

  it('grant: refuses to add a user who is not a member of the workspace', async () => {
    const outsider = await harness.signIn('grant-outsider@local.com', 'Outsider');

    const res = await addGrant(outsider.user.id, 'viewer');

    expect(res.status).toBe(400);
    const grant = await harness.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: outsider.user.id } },
    });
    expect(grant).toBeNull();
  });
});
