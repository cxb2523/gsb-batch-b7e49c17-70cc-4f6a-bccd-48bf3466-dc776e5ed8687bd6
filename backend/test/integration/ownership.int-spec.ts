import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';

/**
 * The single-Owner invariant and the only way an Owner changes: the transfer primitive.
 */
describe('Workspace ownership (Integration)', () => {
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

  async function scenario() {
    const owner = await harness.signIn('owner-transfer@local.com', 'Owner');
    const admin = await harness.signIn('admin-transfer@local.com', 'Admin');
    const keyless = await harness.signIn('keyless-transfer@local.com', 'Keyless');

    const workspace = await harness.seedWorkspace({ name: 'Ownership Lab' });
    const ownerMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
      encryptedOrgKey: 'owner-wrapped-key',
    });
    const adminMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: admin.user.id,
      role: 'admin',
      encryptedOrgKey: 'admin-wrapped-key',
    });
    const keylessMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: keyless.user.id,
      role: 'editor',
      encryptedOrgKey: null,
    });

    return { owner, admin, keyless, workspace, ownerMember, adminMember, keylessMember };
  }

  const transfer = (actor: SignedInActor, workspaceId: string, memberId: string) =>
    harness
      .request()
      .post(`/api/workspaces/${workspaceId}/transfer-ownership`)
      .set('Cookie', actor.cookie)
      .set('active-organization', workspaceId)
      .send({ memberId });

  it('single owner: the database refuses a second owner in the same workspace', async () => {
    const { workspace } = await scenario();
    const stranger = await harness.signIn('second-owner@local.com', 'Second Owner');

    await expect(
      harness.prisma.$executeRawUnsafe(
        `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
         VALUES ('${randomUUID()}', '${workspace.id}', '${stranger.user.id}', 'owner', now())`,
      ),
    ).rejects.toThrow('member_one_owner_per_workspace');
  });

  it('transfer: the owner hands the workspace over atomically and keeps their key as admin', async () => {
    const { owner, workspace, adminMember } = await scenario();

    const res = await transfer(owner, workspace.id, adminMember.id);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: adminMember.id, role: 'owner' });

    const rows = await harness.prisma.member.findMany({
      where: { organizationId: workspace.id },
      orderBy: { id: 'asc' },
    });
    expect(rows.filter((row) => row.role === 'owner')).toHaveLength(1);
    expect(rows.find((row) => row.id === adminMember.id)?.role).toBe('owner');

    const previousOwner = rows.find((row) => row.userId === owner.user.id);
    expect(previousOwner?.role).toBe('admin');
    expect(previousOwner?.encryptedOrgKey).toBe('owner-wrapped-key');
  });

  it('transfer: a non-owner is refused', async () => {
    const { admin, workspace, keylessMember } = await scenario();

    const res = await transfer(admin, workspace.id, keylessMember.id);

    expect(res.status).toBe(403);
    const owners = await harness.prisma.member.count({
      where: { organizationId: workspace.id, role: 'owner' },
    });
    expect(owners).toBe(1);
  });

  it('transfer: a target who does not hold the workspace key is refused', async () => {
    const { owner, workspace, keylessMember } = await scenario();

    const res = await transfer(owner, workspace.id, keylessMember.id);

    expect(res.status).toBe(400);
    expect(String(res.body?.message)).toContain('does not hold the workspace key');
    const target = await harness.prisma.member.findUniqueOrThrow({
      where: { id: keylessMember.id },
    });
    expect(target.role).toBe('editor');
  });

  it('owner: the Owner can neither change their own role nor be removed through the member routes', async () => {
    const { owner, workspace, ownerMember } = await scenario();

    const roleRes = await harness
      .request()
      .patch(`/api/workspaces/${workspace.id}/members/${ownerMember.id}`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id)
      .send({ role: 'admin' });
    expect(roleRes.status).toBe(403);

    const removeRes = await harness
      .request()
      .delete(`/api/workspaces/${workspace.id}/members/${ownerMember.id}`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspace.id);
    expect(removeRes.status).toBe(403);

    const stillOwner = await harness.prisma.member.findUniqueOrThrow({
      where: { id: ownerMember.id },
    });
    expect(stillOwner.role).toBe('owner');
  });

  it('transfer: deleting an account that owns a shared workspace transfers it under the unique index', async () => {
    const { owner, workspace, adminMember } = await scenario();

    const res = await harness
      .request()
      .post('/api/user/delete-account')
      .set('Cookie', owner.cookie)
      .send({ transfers: { [workspace.id]: adminMember.id } });

    expect(res.status).toBe(200);

    const rows = await harness.prisma.member.findMany({
      where: { organizationId: workspace.id },
    });
    expect(rows.filter((row) => row.role === 'owner')).toHaveLength(1);
    expect(rows.find((row) => row.id === adminMember.id)?.role).toBe('owner');
    expect(rows.some((row) => row.userId === owner.user.id)).toBe(false);
  });
});
