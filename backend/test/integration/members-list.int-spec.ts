import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';

/**
 * R7: the members list is always bounded and always has the same shape.
 */
describe('Workspace members list (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let workspaceId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();

    owner = await harness.signIn('members-owner@local.com', 'Members Owner');
    const workspace = await harness.seedWorkspace({ name: 'Many Members' });
    workspaceId = workspace.id;

    await harness.seedMember({
      organizationId: workspaceId,
      userId: owner.user.id,
      role: 'owner',
    });

    const members = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        harness.prisma.user.create({
          data: {
            id: randomUUID(),
            name: `Member ${i}`,
            email: `member-${i}-${randomUUID()}@local.com`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      ),
    );
    await Promise.all(
      members.map((user) =>
        harness.seedMember({ organizationId: workspaceId, userId: user.id, role: 'editor' }),
      ),
    );
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const list = (query = '') =>
    harness
      .request()
      .get(`/api/workspaces/${workspaceId}/members${query}`)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspaceId);

  it('members list: defaults to page 1 with 20 items and includes pagination', async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 25,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('members list: returns the next page and clamps the page size to 100', async () => {
    const res = await list('?page=2&limit=20');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.pagination.page).toBe(2);

    const oversized = await list('?page=1&limit=500');
    expect(oversized.status).toBe(200);
    expect(oversized.body.pagination.limit).toBe(100);
  });
});
