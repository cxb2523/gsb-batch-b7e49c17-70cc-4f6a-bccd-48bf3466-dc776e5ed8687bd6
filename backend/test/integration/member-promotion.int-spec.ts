import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { V1_WRAPPED_KEY } from './fixtures.js';

/**
 * C2: promoting a member to admin must carry the wrapped workspace key to the target, and must
 * never write it onto the actor. E1: demoting an admin must take their key away.
 */
describe('Workspace member role changes and wrapped keys (Integration)', () => {
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

  const signInAs = (prefix: string): Promise<SignedInActor> =>
    harness.signIn(`${prefix}@local.com`, prefix);

  async function seedWorkspace(owner: SignedInActor) {
    const workspace = await harness.seedWorkspace({ name: 'Acme' });
    const ownerMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
      encryptedOrgKey: 'owners-wrapped-workspace-key',
    });
    return { workspace, ownerMember };
  }

  const changeRole = (
    actor: SignedInActor,
    workspaceId: string,
    memberId: string,
    body: Record<string, unknown>,
  ) =>
    harness
      .request()
      .patch(`/api/workspaces/${workspaceId}/members/${memberId}`)
      .set('Cookie', actor.cookie)
      .set('active-organization', workspaceId)
      .send(body);

  it("writes the wrapped key to the target and leaves the actor's own key untouched", async () => {
    const owner = await signInAs('promote-owner');
    const target = await signInAs('promote-target');
    const { workspace, ownerMember } = await seedWorkspace(owner);
    const targetMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: target.user.id,
      role: 'editor',
    });

    const res = await changeRole(owner, workspace.id, targetMember.id, {
      role: 'admin',
      encryptedOrgKey: V1_WRAPPED_KEY,
    });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect(res.body.encryptedOrgKey).toBe(V1_WRAPPED_KEY);

    const promoted = await harness.prisma.member.findUniqueOrThrow({
      where: { id: targetMember.id },
    });
    expect(promoted.role).toBe('admin');
    expect(promoted.encryptedOrgKey).toBe(V1_WRAPPED_KEY);

    const actorAfter = await harness.prisma.member.findUniqueOrThrow({
      where: { id: ownerMember.id },
    });
    expect(actorAfter.encryptedOrgKey).toBe('owners-wrapped-workspace-key');
  });

  it('refuses to promote to admin without a wrapped key', async () => {
    const owner = await signInAs('no-key-owner');
    const target = await signInAs('no-key-target');
    const { workspace } = await seedWorkspace(owner);
    const targetMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: target.user.id,
      role: 'editor',
    });

    const res = await changeRole(owner, workspace.id, targetMember.id, { role: 'admin' });

    expect(res.status).toBe(400);
    const unchanged = await harness.prisma.member.findUniqueOrThrow({
      where: { id: targetMember.id },
    });
    expect(unchanged.role).toBe('editor');
    expect(unchanged.encryptedOrgKey).toBeNull();
  });

  it('refuses an Admin who tries to change their own role, and keeps their key', async () => {
    const owner = await signInAs('self-owner');
    const admin = await signInAs('self-admin');
    const { workspace } = await seedWorkspace(owner);
    const adminMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: admin.user.id,
      role: 'admin',
      encryptedOrgKey: V1_WRAPPED_KEY,
    });

    const res = await changeRole(admin, workspace.id, adminMember.id, { role: 'editor' });

    expect(res.status).toBe(403);
    const unchanged = await harness.prisma.member.findUniqueOrThrow({
      where: { id: adminMember.id },
    });
    expect(unchanged.role).toBe('admin');
    expect(unchanged.encryptedOrgKey).toBe(V1_WRAPPED_KEY);
  });

  it('refuses a role change from a member who is neither Owner nor Admin', async () => {
    const owner = await signInAs('forbid-owner');
    const actor = await signInAs('forbid-actor');
    const target = await signInAs('forbid-target');
    const { workspace } = await seedWorkspace(owner);
    await harness.seedMember({
      organizationId: workspace.id,
      userId: actor.user.id,
      role: 'editor',
    });
    const targetMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: target.user.id,
      role: 'viewer',
    });

    const res = await changeRole(actor, workspace.id, targetMember.id, { role: 'admin' });

    expect(res.status).toBe(403);
    const unchanged = await harness.prisma.member.findUniqueOrThrow({
      where: { id: targetMember.id },
    });
    expect(unchanged.role).toBe('viewer');
    expect(unchanged.encryptedOrgKey).toBeNull();
  });

  it('clears the wrapped key when an admin is demoted', async () => {
    const owner = await signInAs('demote-owner');
    const target = await signInAs('demote-target');
    const { workspace } = await seedWorkspace(owner);
    const targetMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: target.user.id,
      role: 'admin',
      encryptedOrgKey: 'demoted-members-wrapped-key',
    });

    const res = await changeRole(owner, workspace.id, targetMember.id, { role: 'viewer' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('viewer');
    expect(res.body.encryptedOrgKey).toBeNull();
    const demoted = await harness.prisma.member.findUniqueOrThrow({
      where: { id: targetMember.id },
    });
    expect(demoted.role).toBe('viewer');
    expect(demoted.encryptedOrgKey).toBeNull();
  });
});
