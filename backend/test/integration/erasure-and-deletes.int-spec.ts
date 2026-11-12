import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { WorkspacesService } from '../../src/workspaces/workspaces.service.js';
import { BlobPurgeService } from '../../src/maintenance/blob-purge.service.js';

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new Error('expected at least one item');
  }
  return head;
}

describe('Atomic deletes, member removal and account erasure (Integration)', () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
  });

  beforeEach(async () => {
    await harness.resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const signInAs = (prefix: string): Promise<SignedInActor> =>
    harness.signIn(`${prefix}@local.com`, prefix);

  /** A workspace owned by `owner`, with one project holding boards that have stored objects. */
  async function seedWorkspaceWithBoards(owner: SignedInActor, boardCount = 2) {
    const workspace = await harness.seedWorkspace({ name: 'Acme' });
    const ownerMember = await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
      encryptedOrgKey: 'wrapped-workspace-key',
    });
    const project = await harness.seedProject({ organizationId: workspace.id, name: 'Roadmap' });
    const boards = await Promise.all(
      Array.from({ length: boardCount }, (_, index) =>
        harness.seedBoard({
          projectId: project.id,
          title: `Board ${index}`,
          payload: Buffer.from(`cipher-${index}`),
        }),
      ),
    );
    return { workspace, ownerMember, project, boards };
  }

  const storedObjects = () => harness.storage.objects.size;
  const queuedBoardIds = async () =>
    (await harness.prisma.pendingBlobDeletion.findMany({ select: { objectKey: true } })).map(
      (row) => row.objectKey.split('/')[1] ?? row.objectKey,
    );

  describe('deleting a workspace', () => {
    it('removes everything below it in one transaction and queues the stored objects', async () => {
      const owner = await signInAs('ws-owner');
      const { workspace, project, boards } = await seedWorkspaceWithBoards(owner);
      const member = await signInAs('ws-member');
      await harness.seedMember({
        organizationId: workspace.id,
        userId: member.user.id,
        role: 'editor',
      });
      await harness.seedProjectMember({
        projectId: project.id,
        userId: member.user.id,
        encryptedProjectKey: 'wrapped-project-key',
      });

      const res = await harness
        .request()
        .delete(`/api/workspaces/${workspace.id}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(res.status).toBe(200);
      expect(await harness.prisma.organization.count({ where: { id: workspace.id } })).toBe(0);
      expect(await harness.prisma.project.count()).toBe(0);
      expect(await harness.prisma.board.count()).toBe(0);
      expect(await harness.prisma.projectMember.count()).toBe(0);
      expect(await harness.prisma.member.count({ where: { organizationId: workspace.id } })).toBe(
        0,
      );
      expect((await queuedBoardIds()).sort()).toEqual(boards.map((b) => b.id).sort());

      // Nothing was removed from storage during the request; the queue does it afterwards.
      expect(storedObjects()).toBe(2);
      expect(await harness.purge.processDue()).toBe(2);
      expect(storedObjects()).toBe(0);
      expect(await queuedBoardIds()).toEqual([]);
    });

    it('changes nothing if the stored objects cannot be queued', async () => {
      const owner = await signInAs('ws-owner');
      const { workspace } = await seedWorkspaceWithBoards(owner);
      vi.spyOn(harness.app.get(BlobPurgeService), 'enqueue').mockRejectedValueOnce(
        new Error('queue down'),
      );

      const res = await harness
        .request()
        .delete(`/api/workspaces/${workspace.id}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(res.status).toBe(500);
      expect(await harness.prisma.organization.count({ where: { id: workspace.id } })).toBe(1);
      expect(await harness.prisma.board.count()).toBe(2);
      expect(await queuedBoardIds()).toEqual([]);
    });

    it('does not answer a repeated delete with a 500', async () => {
      const owner = await signInAs('ws-owner');
      const { workspace } = await seedWorkspaceWithBoards(owner);
      const deleteOnce = () =>
        harness
          .request()
          .delete(`/api/workspaces/${workspace.id}`)
          .set('Cookie', owner.cookie)
          .set('active-organization', workspace.id);

      expect((await deleteOnce()).status).toBe(200);
      expect((await deleteOnce()).status).toBeLessThan(500);
    });
  });

  describe('deleting a project', () => {
    it('removes its boards and grants and queues exactly the boards that have stored objects', async () => {
      const owner = await signInAs('p-owner');
      const { workspace, project, boards } = await seedWorkspaceWithBoards(owner);
      const emptyBoard = await harness.seedBoard({ projectId: project.id, title: 'Never saved' });

      const res = await harness
        .request()
        .delete(`/api/projects/${project.id}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(res.status).toBe(200);
      expect(await harness.prisma.project.count()).toBe(0);
      expect(await harness.prisma.board.count({ where: { id: emptyBoard.id } })).toBe(0);
      expect((await queuedBoardIds()).sort()).toEqual(boards.map((b) => b.id).sort());
    });

    it('changes nothing if the stored objects cannot be queued', async () => {
      const owner = await signInAs('p-owner');
      const { workspace, project } = await seedWorkspaceWithBoards(owner);
      vi.spyOn(harness.app.get(BlobPurgeService), 'enqueue').mockRejectedValueOnce(
        new Error('queue down'),
      );

      const res = await harness
        .request()
        .delete(`/api/projects/${project.id}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(res.status).toBe(500);
      expect(await harness.prisma.project.count()).toBe(1);
      expect(await harness.prisma.board.count()).toBe(2);
    });
  });

  describe('deleting a board', () => {
    it('deletes the row and queues its object, and a second delete is a 404', async () => {
      const owner = await signInAs('b-owner');
      const { workspace, boards } = await seedWorkspaceWithBoards(owner, 1);
      const boardId = first(boards).id;
      const deleteBoard = () =>
        harness
          .request()
          .delete(`/api/boards/${boardId}`)
          .set('Cookie', owner.cookie)
          .set('active-organization', workspace.id);

      expect((await deleteBoard()).status).toBe(200);
      expect(await queuedBoardIds()).toEqual([boardId]);
      expect((await deleteBoard()).status).toBe(404);
    });
  });

  describe('the blob deletion queue', () => {
    it('keeps a row whose object could not be deleted, and finishes it on a later pass', async () => {
      const owner = await signInAs('q-owner');
      const { workspace, boards } = await seedWorkspaceWithBoards(owner, 1);
      const boardId = first(boards).id;
      await harness
        .request()
        .delete(`/api/boards/${boardId}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      const key = `boards/${boardId}/v1.bin`;
      harness.storage.failDeletesFor.add(key);
      // The row is stamped with this machine's clock and claimed against the database's, which
      // can trail by a few milliseconds under load; make it clearly due.
      await harness.prisma.pendingBlobDeletion.updateMany({
        data: { nextAttemptAt: new Date(Date.now() - 60_000) },
      });
      expect(await harness.purge.processDue()).toBe(0);

      const failed = await harness.prisma.pendingBlobDeletion.findFirstOrThrow({
        where: { objectKey: key },
      });
      expect(failed.attempts).toBe(1);
      expect(failed.lastError).toBe('simulated storage failure');
      expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(storedObjects()).toBe(1);

      // Not due yet, so another pass leaves it alone.
      expect(await harness.purge.processDue()).toBe(0);
      expect(
        (await harness.prisma.pendingBlobDeletion.findFirstOrThrow({ where: { objectKey: key } }))
          .attempts,
      ).toBe(1);

      // The storage recovers and the row becomes due.
      harness.storage.failDeletesFor.clear();
      await harness.prisma.pendingBlobDeletion.update({
        where: {
          id: (
            await harness.prisma.pendingBlobDeletion.findFirstOrThrow({ where: { objectKey: key } })
          ).id,
        },
        // Clearly in the past: the queue compares this with the database's clock, not ours.
        data: { nextAttemptAt: new Date(Date.now() - 60_000) },
      });
      expect(await harness.purge.processDue()).toBe(1);
      expect(storedObjects()).toBe(0);
      expect(await queuedBoardIds()).toEqual([]);
    });

    it('deletes a large workspace in a handful of bulk requests, not one per board', async () => {
      const owner = await signInAs('bulk-owner');
      const { workspace, project } = await seedWorkspaceWithBoards(owner, 0);
      await harness.prisma.board.createMany({
        data: Array.from({ length: 2500 }, (_, index) => ({
          id: randomUUID(),
          projectId: project.id,
          title: `Board ${index}`,
          hasPayload: true,
        })),
      });

      const res = await harness
        .request()
        .delete(`/api/workspaces/${workspace.id}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id);

      expect(res.status).toBe(200);
      expect(harness.storage.deleteRequests).toEqual([]);
      expect(await harness.prisma.pendingBlobDeletion.count()).toBe(2500);

      await harness.purge.processDue();

      expect(harness.storage.deleteRequests).toEqual([1000, 1000, 500]);
      expect(await harness.prisma.pendingBlobDeletion.count()).toBe(0);
    });
  });

  describe('removing a member', () => {
    async function seedRemovableMember() {
      const owner = await signInAs('rm-owner');
      const { workspace, project, boards } = await seedWorkspaceWithBoards(owner, 1);
      const leaver = await signInAs('rm-leaver');
      const leaverMember = await harness.seedMember({
        organizationId: workspace.id,
        userId: leaver.user.id,
        role: 'admin',
        encryptedOrgKey: 'leavers-wrapped-workspace-key',
      });
      await harness.seedProjectMember({
        projectId: project.id,
        userId: leaver.user.id,
        encryptedProjectKey: 'leavers-wrapped-project-key',
      });
      await harness.prisma.invitation.create({
        data: {
          id: randomUUID(),
          organizationId: workspace.id,
          email: leaver.user.email,
          role: 'editor',
          status: 'pending',
          inviterId: owner.user.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      return { owner, leaver, leaverMember, workspace, project, boards };
    }

    const removeMember = (owner: SignedInActor, workspaceId: string, memberId: string) =>
      harness
        .request()
        .delete(`/api/workspaces/${workspaceId}/members/${memberId}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspaceId);

    it('deletes their grants, wrapped keys and invitations, and leaves the content in place', async () => {
      const { owner, leaver, leaverMember, workspace, boards } = await seedRemovableMember();

      const res = await removeMember(owner, workspace.id, leaverMember.id);

      expect(res.status).toBe(200);
      expect(await harness.prisma.member.count({ where: { userId: leaver.user.id } })).toBe(0);
      expect(await harness.prisma.projectMember.count({ where: { userId: leaver.user.id } })).toBe(
        0,
      );
      expect(await harness.prisma.invitation.count({ where: { email: leaver.user.email } })).toBe(
        0,
      );
      expect(await harness.prisma.board.count({ where: { id: first(boards).id } })).toBe(1);
      expect(await harness.prisma.user.count({ where: { id: leaver.user.id } })).toBe(1);

      expect((await removeMember(owner, workspace.id, leaverMember.id)).status).toBe(404);
    });

    it('rolls back every deletion if one step fails part-way', async () => {
      const { owner, leaver, leaverMember, workspace } = await seedRemovableMember();
      const service = harness.app.get(WorkspacesService);
      const realRevoke = service.revokeMembership.bind(service);
      vi.spyOn(service, 'revokeMembership').mockImplementationOnce(async (tx, ...args) => {
        await realRevoke(tx, ...args);
        throw new Error('failure after the deletes ran');
      });

      const res = await removeMember(owner, workspace.id, leaverMember.id);

      expect(res.status).toBe(500);
      expect(await harness.prisma.member.count({ where: { userId: leaver.user.id } })).toBe(1);
      expect(await harness.prisma.projectMember.count({ where: { userId: leaver.user.id } })).toBe(
        1,
      );
      expect(await harness.prisma.invitation.count({ where: { email: leaver.user.email } })).toBe(
        1,
      );
    });
  });

  describe('deleting an account', () => {
    const deleteAccount = (actor: SignedInActor, body: Record<string, unknown>) =>
      harness.request().post('/api/user/delete-account').set('Cookie', actor.cookie).send(body);

    async function seedSharedWorkspace(
      owner: SignedInActor,
      other: SignedInActor,
      otherHoldsKey: boolean,
    ) {
      const workspace = await harness.seedWorkspace({ name: 'Shared' });
      await harness.seedMember({
        organizationId: workspace.id,
        userId: owner.user.id,
        role: 'owner',
        encryptedOrgKey: 'owners-wrapped-workspace-key',
      });
      const otherMember = await harness.seedMember({
        organizationId: workspace.id,
        userId: other.user.id,
        role: otherHoldsKey ? 'admin' : 'editor',
        encryptedOrgKey: otherHoldsKey ? 'others-wrapped-workspace-key' : null,
      });
      return { workspace, otherMember };
    }

    it('reports which members can take over a workspace', async () => {
      const owner = await signInAs('own');
      const withKey = await signInAs('with-key');
      const withoutKey = await signInAs('without-key');
      const { workspace } = await seedSharedWorkspace(owner, withKey, true);
      await harness.seedMember({
        organizationId: workspace.id,
        userId: withoutKey.user.id,
        role: 'editor',
      });

      const res = await harness
        .request()
        .get('/api/user/owned-workspaces')
        .set('Cookie', owner.cookie);

      expect(res.status).toBe(200);
      const others: Array<{ email: string; canReceiveOwnership: boolean }> =
        res.body[0].otherMembers;
      expect(others.find((m) => m.email === withKey.user.email)?.canReceiveOwnership).toBe(true);
      expect(others.find((m) => m.email === withoutKey.user.email)?.canReceiveOwnership).toBe(
        false,
      );
    });

    it('destroys nothing when one workspace cannot be resolved, even if another could be deleted (C7)', async () => {
      const owner = await signInAs('c7-owner');
      const keyless = await signInAs('c7-keyless');
      const { workspace: solo } = await seedWorkspaceWithBoards(owner, 1);
      const { workspace: shared, otherMember } = await seedSharedWorkspace(owner, keyless, false);

      const res = await deleteAccount(owner, {
        confirmSoleDeletion: true,
        transfers: { [shared.id]: otherMember.id },
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/encryption key/);
      expect(await harness.prisma.organization.count({ where: { id: solo.id } })).toBe(1);
      expect(await harness.prisma.board.count()).toBe(1);
      expect(await harness.prisma.user.count({ where: { id: owner.user.id } })).toBe(1);
      expect(await queuedBoardIds()).toEqual([]);
    });

    it('transfers a workspace to a member who holds its key and then erases the user completely', async () => {
      const leaving = await signInAs('leaving');
      const successor = await signInAs('successor');
      const { workspace, otherMember } = await seedSharedWorkspace(leaving, successor, true);
      const project = await harness.seedProject({ organizationId: workspace.id, name: 'Kept' });
      await harness.seedProjectMember({
        projectId: project.id,
        userId: leaving.user.id,
        encryptedProjectKey: 'leavers-wrapped-project-key',
      });
      const board = await harness.seedBoard({
        projectId: project.id,
        title: 'Kept board',
        payload: Buffer.from('cipher'),
      });
      await harness.prisma.account.create({
        data: {
          id: randomUUID(),
          accountId: 'provider-account-1',
          providerId: 'github',
          userId: leaving.user.id,
          accessToken: 'oauth-access-token',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await harness.prisma.invitation.create({
        data: {
          id: randomUUID(),
          organizationId: workspace.id,
          email: 'someone-else@local.com',
          role: 'viewer',
          status: 'pending',
          inviterId: leaving.user.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await deleteAccount(leaving, { transfers: { [workspace.id]: otherMember.id } });

      expect(res.status).toBe(200);
      const uid = leaving.user.id;
      expect(await harness.prisma.user.count({ where: { id: uid } })).toBe(0);
      expect(await harness.prisma.session.count({ where: { userId: uid } })).toBe(0);
      expect(await harness.prisma.account.count({ where: { userId: uid } })).toBe(0);
      expect(await harness.prisma.member.count({ where: { userId: uid } })).toBe(0);
      expect(await harness.prisma.projectMember.count({ where: { userId: uid } })).toBe(0);
      expect(await harness.prisma.invitation.count({ where: { inviterId: uid } })).toBe(0);

      const newOwner = await harness.prisma.member.findUniqueOrThrow({
        where: { id: otherMember.id },
      });
      expect(newOwner.role).toBe('owner');
      expect(newOwner.encryptedOrgKey).toBe('others-wrapped-workspace-key');
      expect(await harness.prisma.project.count({ where: { id: project.id } })).toBe(1);
      expect(await harness.prisma.board.count({ where: { id: board.id } })).toBe(1);
      expect(await queuedBoardIds()).toEqual([]);
    });

    it('deletes a confirmed sole-member workspace with the user and queues its stored objects', async () => {
      const owner = await signInAs('solo');
      const { workspace, boards } = await seedWorkspaceWithBoards(owner, 2);

      const res = await deleteAccount(owner, { confirmSoleDeletion: true });

      expect(res.status).toBe(200);
      expect(await harness.prisma.organization.count({ where: { id: workspace.id } })).toBe(0);
      expect(await harness.prisma.user.count({ where: { id: owner.user.id } })).toBe(0);
      expect((await queuedBoardIds()).sort()).toEqual(boards.map((b) => b.id).sort());
      await harness.purge.processDue();
      expect(storedObjects()).toBe(0);
    });

    it('rolls everything back if the transaction fails after a workspace was deleted', async () => {
      const owner = await signInAs('rollback');
      const { workspace } = await seedWorkspaceWithBoards(owner, 1);
      const service = harness.app.get(WorkspacesService);
      const realDelete = service.deleteWorkspaceWithin.bind(service);
      vi.spyOn(service, 'deleteWorkspaceWithin').mockImplementationOnce(async (tx, id) => {
        await realDelete(tx, id);
        throw new Error('failure after the workspace delete ran');
      });

      const res = await deleteAccount(owner, { confirmSoleDeletion: true });

      expect(res.status).toBe(500);
      expect(await harness.prisma.organization.count({ where: { id: workspace.id } })).toBe(1);
      expect(await harness.prisma.board.count()).toBe(1);
      expect(await harness.prisma.user.count({ where: { id: owner.user.id } })).toBe(1);
      expect(await queuedBoardIds()).toEqual([]);
    });
  });
});
