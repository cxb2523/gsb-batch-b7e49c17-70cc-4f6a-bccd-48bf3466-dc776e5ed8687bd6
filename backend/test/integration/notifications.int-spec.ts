import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { v1WrappedKey } from './fixtures.js';
import { DataCleanupService } from '../../src/privacy/data-cleanup.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Notifications (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let admin: SignedInActor;
  let editor: SignedInActor;
  let invitee: SignedInActor;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();

    owner = await harness.signIn('notify-owner@local.com', 'Olive Owner');
    admin = await harness.signIn('notify-admin@local.com', 'Adam Admin');
    editor = await harness.signIn('notify-editor@local.com', 'Edith Editor');
    invitee = await harness.signIn('notify-invitee@local.com', 'Ivy Invitee');

    const workspace = await harness.seedWorkspace({ name: 'Notify Workspace' });
    workspaceId = workspace.id;
    await harness.seedMember({ organizationId: workspaceId, userId: owner.user.id, role: 'owner' });
    await harness.seedMember({ organizationId: workspaceId, userId: admin.user.id, role: 'admin' });
    await harness.seedMember({
      organizationId: workspaceId,
      userId: editor.user.id,
      role: 'editor',
    });
    const project = await harness.seedProject({ organizationId: workspaceId, name: 'Roadmap' });
    projectId = project.id;
  });

  beforeEach(async () => {
    await harness.prisma.notification.deleteMany();
    await harness.prisma.invitation.deleteMany();
    await harness.prisma.projectMember.deleteMany();
    await harness.prisma.member.deleteMany({ where: { userId: invitee.user.id } });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const inbox = (actor: SignedInActor, query = '') =>
    harness.request().get(`/api/notifications${query}`).set('Cookie', actor.cookie);

  async function invite(projectIds: string[]): Promise<string> {
    const res = await harness
      .request()
      .post(`/api/workspaces/${workspaceId}/members/invite`)
      .set('Cookie', owner.cookie)
      .send({ email: invitee.user.email, role: 'editor', projectIds });
    expect(res.status).toBe(201);
    return String(res.body.id);
  }

  const accept = (inviteId: string) =>
    harness.request().post(`/api/invitations/${inviteId}/accept`).set('Cookie', invitee.cookie);

  describe('when an invitation is accepted', () => {
    it('tells the owner and the admin, naming the person and the projects waiting, and nobody else', async () => {
      const inviteId = await invite([projectId]);

      expect((await accept(inviteId)).status).toBe(201);

      const administratorInboxes = await Promise.all([owner, admin].map((actor) => inbox(actor)));
      for (const res of administratorInboxes) {
        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toMatchObject({
          kind: 'invitation_accepted',
          workspaceId,
          readAt: null,
          data: {
            workspaceName: 'Notify Workspace',
            personName: 'Ivy Invitee',
            projectsWaiting: 1,
          },
        });
      }
      expect((await inbox(editor)).body.items).toEqual([]);
      expect((await inbox(invitee)).body.items).toEqual([]);
    });

    it('does not tell anybody a second time when the same link is used again', async () => {
      const inviteId = await invite([]);
      await accept(inviteId);
      await accept(inviteId);

      expect((await inbox(owner)).body.items).toHaveLength(1);
    });

    it('tells nobody when the wrong account tries to accept', async () => {
      const inviteId = await invite([projectId]);

      const refused = await harness
        .request()
        .post(`/api/invitations/${inviteId}/accept`)
        .set('Cookie', editor.cookie);

      expect(refused.status).toBe(403);
      expect((await inbox(owner)).body.items).toEqual([]);
    });
  });

  describe('when somebody is given access to a project', () => {
    it('tells that person, naming the project', async () => {
      const res = await harness
        .request()
        .post(`/api/projects/${projectId}/members`)
        .set('Cookie', owner.cookie)
        .send({ userId: editor.user.id, role: 'editor', encryptedProjectKey: v1WrappedKey('e') });
      expect(res.status).toBe(201);

      const received = await inbox(editor);
      expect(received.body.items).toHaveLength(1);
      expect(received.body.items[0]).toMatchObject({
        kind: 'access_granted',
        data: { workspaceName: 'Notify Workspace', projectId, projectName: 'Roadmap' },
      });
      expect((await inbox(owner)).body.items).toEqual([]);
    });

    it('tells nobody when the grant is refused', async () => {
      await harness.seedProjectMember({
        projectId,
        userId: editor.user.id,
        role: 'editor',
        encryptedProjectKey: v1WrappedKey('already'),
      });

      const res = await harness
        .request()
        .post(`/api/projects/${projectId}/members`)
        .set('Cookie', owner.cookie)
        .send({ userId: editor.user.id, role: 'editor', encryptedProjectKey: v1WrappedKey('e') });

      expect(res.status).toBe(409);
      expect((await inbox(editor)).body.items).toEqual([]);
    });
  });

  describe('when a role changes or a person is removed', () => {
    let editorMemberId: string;

    beforeEach(async () => {
      const member = await harness.prisma.member.findFirstOrThrow({
        where: { organizationId: workspaceId, userId: editor.user.id },
      });
      editorMemberId = member.id;
      await harness.prisma.member.update({
        where: { id: editorMemberId },
        data: { role: 'editor' },
      });
    });

    it('tells the person their new role', async () => {
      const res = await harness
        .request()
        .patch(`/api/workspaces/${workspaceId}/members/${editorMemberId}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'viewer' });
      expect(res.status).toBe(200);

      const received = await inbox(editor);
      expect(received.body.items[0]).toMatchObject({
        kind: 'role_changed',
        data: { workspaceName: 'Notify Workspace', role: 'viewer' },
      });
    });

    it('tells nobody when the role stayed the same', async () => {
      await harness
        .request()
        .patch(`/api/workspaces/${workspaceId}/members/${editorMemberId}`)
        .set('Cookie', owner.cookie)
        .send({ role: 'editor' });

      expect((await inbox(editor)).body.items).toEqual([]);
    });

    it('tells the removed person which workspace they were removed from', async () => {
      const res = await harness
        .request()
        .delete(`/api/workspaces/${workspaceId}/members/${editorMemberId}`)
        .set('Cookie', owner.cookie);
      expect(res.status).toBe(200);

      const received = await inbox(editor);
      expect(received.body.items[0]).toMatchObject({
        kind: 'removed_from_workspace',
        data: { workspaceName: 'Notify Workspace' },
      });

      await harness.seedMember({
        id: editorMemberId,
        organizationId: workspaceId,
        userId: editor.user.id,
        role: 'editor',
      });
    });
  });

  describe('when a role inside one project changes', () => {
    const changeRole = (actor: SignedInActor, userId: string, role: string) =>
      harness
        .request()
        .patch(`/api/projects/${projectId}/members/${userId}`)
        .set('Cookie', actor.cookie)
        .send({ role });

    beforeEach(async () => {
      await harness.seedProjectMember({
        projectId,
        userId: editor.user.id,
        role: 'editor',
        encryptedProjectKey: v1WrappedKey('role'),
      });
    });

    it('tells the person the project and their new role', async () => {
      expect((await changeRole(owner, editor.user.id, 'admin')).status).toBe(200);

      const received = await inbox(editor);
      expect(received.body.items).toHaveLength(1);
      expect(received.body.items[0]).toMatchObject({
        kind: 'project_role_changed',
        workspaceId,
        data: {
          workspaceName: 'Notify Workspace',
          projectId,
          projectName: 'Roadmap',
          role: 'admin',
        },
      });
    });

    it('tells nobody when the role stayed the same', async () => {
      expect((await changeRole(owner, editor.user.id, 'editor')).status).toBe(200);

      expect((await inbox(editor)).body.items).toEqual([]);
    });

    it('is not sent to the Project Admin who changed their own role', async () => {
      await changeRole(owner, editor.user.id, 'admin');
      await harness.prisma.notification.deleteMany();

      expect((await changeRole(editor, editor.user.id, 'viewer')).status).toBe(200);

      expect((await inbox(editor)).body.items).toEqual([]);
    });
  });

  describe('when somebody is taken off a project', () => {
    const removeFromProject = (actor: SignedInActor, userId: string) =>
      harness
        .request()
        .delete(`/api/projects/${projectId}/members/${userId}`)
        .set('Cookie', actor.cookie);

    beforeEach(async () => {
      await harness.seedProjectMember({
        projectId,
        userId: editor.user.id,
        role: 'editor',
        encryptedProjectKey: v1WrappedKey('removal'),
      });
    });

    it('tells that person which project, and still lets them see it was in this workspace', async () => {
      expect((await removeFromProject(owner, editor.user.id)).status).toBe(200);

      const received = await inbox(editor);
      expect(received.body.items).toHaveLength(1);
      expect(received.body.items[0]).toMatchObject({
        kind: 'removed_from_project',
        workspaceId,
        data: { workspaceName: 'Notify Workspace', projectName: 'Roadmap' },
      });
    });

    it('tells nobody when the person was not on the project', async () => {
      await harness.prisma.projectMember.deleteMany();

      expect((await removeFromProject(owner, editor.user.id)).status).toBe(404);

      expect((await inbox(editor)).body.items).toEqual([]);
    });

    it('does not tell a Project Admin who removed themselves', async () => {
      await harness.prisma.projectMember.update({
        where: { projectId_userId: { projectId, userId: editor.user.id } },
        data: { role: 'admin' },
      });

      expect((await removeFromProject(editor, editor.user.id)).status).toBe(200);

      expect((await inbox(editor)).body.items).toEqual([]);
    });
  });

  describe('reading and marking', () => {
    async function seed(userId: string, count: number, readAt: Date | null = null) {
      const base = Date.now();
      await harness.prisma.notification.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          userId,
          workspaceId,
          kind: 'role_changed',
          data: { workspaceName: 'Notify Workspace', role: 'viewer' },
          readAt,
          createdAt: new Date(base - index * 1000),
        })),
      });
    }

    it('pages the inbox at least twenty at a time, newest first', async () => {
      await seed(owner.user.id, 25);

      const first = await inbox(owner);
      const second = await inbox(owner, '?page=2');

      expect(first.body.items).toHaveLength(20);
      expect(second.body.items).toHaveLength(5);
      expect(first.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 25,
        hasNextPage: true,
      });
      expect(second.body.pagination).toMatchObject({
        page: 2,
        hasNextPage: false,
        hasPrevPage: true,
      });
      const times = [...first.body.items, ...second.body.items].map((item: { createdAt: string }) =>
        Date.parse(item.createdAt),
      );
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('never gives one person another person’s notifications', async () => {
      await seed(owner.user.id, 3);
      await seed(editor.user.id, 1);

      expect((await inbox(editor)).body.items).toHaveLength(1);
      expect((await inbox(owner)).body.pagination.total).toBe(3);
    });

    it('counts unread ones, marks one read, and marks all read', async () => {
      await seed(owner.user.id, 3);
      const unread = () =>
        harness.request().get('/api/notifications/unread-count').set('Cookie', owner.cookie);
      expect((await unread()).body).toEqual({ count: 3 });

      const [one] = (await inbox(owner)).body.items;
      const marked = await harness
        .request()
        .post(`/api/notifications/${one.id}/read`)
        .set('Cookie', owner.cookie);
      expect(marked.status).toBe(201);
      expect((await unread()).body).toEqual({ count: 2 });

      // Reading it again changes nothing and is not an error.
      const again = await harness
        .request()
        .post(`/api/notifications/${one.id}/read`)
        .set('Cookie', owner.cookie);
      expect(again.status).toBe(201);
      expect((await unread()).body).toEqual({ count: 2 });

      const all = await harness
        .request()
        .post('/api/notifications/read-all')
        .set('Cookie', owner.cookie);
      expect(all.body).toEqual({ updated: 2 });
      expect((await unread()).body).toEqual({ count: 0 });
    });

    it('treats another person’s notification, or an unknown one, as not found and leaves it unread', async () => {
      await seed(owner.user.id, 1);
      const [mine] = (await inbox(owner)).body.items;

      const stranger = await harness
        .request()
        .post(`/api/notifications/${mine.id}/read`)
        .set('Cookie', editor.cookie);
      const unknown = await harness
        .request()
        .post('/api/notifications/does-not-exist/read')
        .set('Cookie', editor.cookie);

      expect(stranger.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(
        (await harness.prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt,
      ).toBeNull();
    });

    it('does not mark another person’s notifications read with read-all', async () => {
      await seed(owner.user.id, 2);

      await harness.request().post('/api/notifications/read-all').set('Cookie', editor.cookie);

      expect(
        await harness.prisma.notification.count({ where: { userId: owner.user.id, readAt: null } }),
      ).toBe(2);
    });

    it('refuses every route to somebody who is not signed in', async () => {
      expect((await harness.request().get('/api/notifications')).status).toBe(401);
      expect((await harness.request().get('/api/notifications/unread-count')).status).toBe(401);
      expect((await harness.request().post('/api/notifications/read-all')).status).toBe(401);
      expect((await harness.request().post('/api/notifications/abc/read')).status).toBe(401);
    });
  });

  describe('data lifecycle', () => {
    it('is removed with the person', async () => {
      const doomed = await harness.signIn('notify-doomed@local.com', 'Doomed');
      await harness.prisma.notification.create({
        data: {
          userId: doomed.user.id,
          workspaceId,
          kind: 'role_changed',
          data: { role: 'viewer' },
        },
      });

      await harness.prisma.user.delete({ where: { id: doomed.user.id } });

      expect(await harness.prisma.notification.count({ where: { userId: doomed.user.id } })).toBe(
        0,
      );
    });

    it('is removed with the workspace', async () => {
      const other = await harness.seedWorkspace({ name: 'Short-lived' });
      await harness.prisma.notification.create({
        data: { userId: owner.user.id, workspaceId: other.id, kind: 'role_changed', data: {} },
      });

      await harness.prisma.organization.delete({ where: { id: other.id } });

      expect(await harness.prisma.notification.count({ where: { workspaceId: other.id } })).toBe(0);
    });

    it('refuses a kind that is not on the list', async () => {
      await expect(
        harness.prisma.notification.create({
          data: { userId: owner.user.id, workspaceId, kind: 'made_up', data: {} },
        }),
      ).rejects.toThrow();
    });

    it('purges only what was read more than a month ago', async () => {
      const base = { userId: owner.user.id, workspaceId, kind: 'role_changed', data: {} };
      await harness.prisma.notification.createMany({
        data: [
          { ...base, readAt: new Date(Date.now() - 40 * DAY_MS) }, // old and read: goes
          { ...base, readAt: new Date(Date.now() - 2 * DAY_MS) }, // recently read: stays
          { ...base, createdAt: new Date(Date.now() - 90 * DAY_MS) }, // old but unread: stays
        ],
      });

      const purged = await harness.app.get(DataCleanupService).purgeReadNotifications();

      expect(purged).toBe(1);
      expect(await harness.prisma.notification.count()).toBe(2);
    });

    it('is part of the data export', async () => {
      await harness.prisma.notification.create({
        data: { userId: owner.user.id, workspaceId, kind: 'role_changed', data: { role: 'admin' } },
      });

      const res = await harness.request().get('/api/user/export-data').set('Cookie', owner.cookie);

      expect(res.status).toBe(200);
      const exported = JSON.parse(res.text);
      expect(exported.notifications).toHaveLength(1);
      expect(exported.notifications[0]).toMatchObject({
        kind: 'role_changed',
        data: { role: 'admin' },
      });
    });
  });

  describe('the live stream', () => {
    /** Reads the stream until `done` is satisfied by the text received so far, or time runs out. */
    async function readUntil(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      done: (received: string) => boolean,
      timeoutMs = 5000,
    ): Promise<string> {
      const decoder = new TextDecoder();
      const deadline = Date.now() + timeoutMs;
      const quiet = (received: string) =>
        new Error(`Stream stayed quiet. Received: ${JSON.stringify(received)}`);

      const readMore = async (received: string): Promise<string> => {
        if (done(received)) return received;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw quiet(received);
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(quiet(received)), remaining)),
        ]);
        if (chunk.done) return received;
        return readMore(received + decoder.decode(chunk.value, { stream: true }));
      };
      return readMore('');
    }

    async function openStream(actor: SignedInActor, controller: AbortController) {
      const baseUrl = await harness.app.getUrl();
      const res = await fetch(`${baseUrl}/api/notifications/stream`, {
        // A browser offers compression; the stream has to stay readable event by event anyway.
        headers: {
          cookie: actor.cookie,
          accept: 'text/event-stream',
          'accept-encoding': 'gzip, deflate, br',
        },
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('The stream has no body');
      return { res, reader };
    }

    beforeAll(async () => {
      await harness.app.listen(0);
    });

    it('opens at once, uncompressed, and says so when something new arrives for that person only', async () => {
      const ownerStream = new AbortController();
      const editorStream = new AbortController();
      try {
        const forOwner = await openStream(owner, ownerStream);
        const forEditor = await openStream(editor, editorStream);

        expect(forOwner.res.status).toBe(200);
        expect(forOwner.res.headers.get('content-type')).toContain('text/event-stream');
        expect(forOwner.res.headers.get('content-encoding')).toBeNull();
        await readUntil(forOwner.reader, (text) => text.includes('event: ready'));
        await readUntil(forEditor.reader, (text) => text.includes('event: ready'));

        // The invitee accepts, which tells the owner (and the admin), not the editor.
        const inviteId = await invite([projectId]);
        await accept(inviteId);

        const received = await readUntil(forOwner.reader, (text) =>
          text.includes('event: changed'),
        );
        expect(received).toContain('event: changed');
        // Nothing about the notification itself travels on the stream.
        expect(received).not.toContain('Ivy');
        expect(received).not.toContain('Notify Workspace');

        await expect(
          readUntil(forEditor.reader, (text) => text.includes('event: changed'), 600),
        ).rejects.toThrow('Stream stayed quiet');
      } finally {
        ownerStream.abort();
        editorStream.abort();
      }
    });

    it('is refused to somebody who is not signed in', async () => {
      const baseUrl = await harness.app.getUrl();

      const res = await fetch(`${baseUrl}/api/notifications/stream`);

      expect(res.status).toBe(401);
    });
  });
});
