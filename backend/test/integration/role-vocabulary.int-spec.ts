import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { V1_WRAPPED_KEY } from './fixtures.js';

/**
 * The role vocabulary is one closed set, enforced by the database and by the invitation API.
 */
describe('Role vocabulary (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let workspaceId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    owner = await harness.signIn('role-vocab-owner@local.com', 'Role Owner');
    const workspace = await harness.seedWorkspace({ name: 'Role Vocabulary' });
    workspaceId = workspace.id;
    await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
    });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  async function expectConstraintViolation(sql: string, constraint: string): Promise<void> {
    await expect(harness.prisma.$executeRawUnsafe(sql)).rejects.toThrow(constraint);
  }

  it('refuses a workspace member with a role outside the four', async () => {
    await expectConstraintViolation(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
       VALUES ('${randomUUID()}', '${workspaceId}', '${owner.user.id}', 'member', now())`,
      'member_role_check',
    );
  });

  it('refuses a project grant with a workspace-only role', async () => {
    const project = await harness.seedProject({
      organizationId: workspaceId,
      name: 'Role Project',
    });

    await expectConstraintViolation(
      `INSERT INTO "project_member" (id, "projectId", "userId", role, "createdAt")
       VALUES ('${randomUUID()}', '${project.id}', '${owner.user.id}', 'owner', now())`,
      'project_member_role_check',
    );
  });

  it('refuses an invitation that grants an administrative role', async () => {
    await expectConstraintViolation(
      `INSERT INTO "invitation" (id, "organizationId", email, role, status, "expiresAt", "inviterId")
       VALUES ('${randomUUID()}', '${workspaceId}', 'someone@local.com', 'admin', 'pending', now() + interval '1 day', '${owner.user.id}')`,
      'invitation_role_check',
    );
  });

  it('rejects an invitation with the retired workspace role through the API', async () => {
    const res = await harness
      .request()
      .post(`/api/workspaces/${workspaceId}/members/invite`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspaceId)
      .send({ email: 'retired-role@local.com', role: 'member' });

    expect(res.status).toBe(400);

    const invitations = await harness.prisma.invitation.count({
      where: { organizationId: workspaceId, email: 'retired-role@local.com' },
    });
    expect(invitations).toBe(0);
  });

  it('the app endpoint creates the workspace owner with the vocabulary role', async () => {
    const res = await harness
      .request()
      .post('/api/workspaces')
      .set('Cookie', owner.cookie)
      .send({
        id: randomUUID(),
        name: 'App Created Workspace',
        encryptedOrgKey: V1_WRAPPED_KEY,
        project: {
          id: randomUUID(),
          name: 'App Created Project',
          encryptedProjectKey: V1_WRAPPED_KEY,
          creatorEncryptedProjectKey: V1_WRAPPED_KEY,
        },
      });

    expect(res.status).toBe(201);

    const organization = await harness.prisma.organization.findFirstOrThrow({
      where: { id: res.body.id },
    });
    const membership = await harness.prisma.member.findFirstOrThrow({
      where: { organizationId: organization.id, userId: owner.user.id },
    });

    expect(membership.role).toBe('owner');
  });
});
