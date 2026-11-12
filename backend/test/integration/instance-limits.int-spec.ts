import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createIntegrationHarness, type IntegrationHarness } from './harness.js';
import { V1_WRAPPED_KEY } from './fixtures.js';
import { AUTH } from '../../src/auth/auth.js';

describe('Instance limits and demo mode (Integration)', () => {
  const harnesses: IntegrationHarness[] = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  });

  const workspaceBody = (name: string) => ({
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

  const boardBody = (projectId: string, title = 'Test Board') => ({
    id: randomUUID(),
    projectId,
    title,
    encryptedBoardKey: V1_WRAPPED_KEY,
    projectKeyVersion: 1,
  });

  function sizedPayload(size: number, version = 1, revision = 1): Buffer {
    const bytes = Buffer.alloc(size);
    bytes[0] = 0x01;
    bytes.writeUInt32BE(version, 1);
    bytes.writeUInt32BE(revision, 5);
    return bytes;
  }

  function sizedFile(size: number, version = 1): Buffer {
    const bytes = Buffer.alloc(size);
    bytes[0] = 0x01;
    bytes.writeUInt32BE(version, 1);
    return bytes;
  }

  describe('Workspace limit (LIMIT_WORKSPACES_PER_ACCOUNT)', () => {
    it('enforces workspace limit and leaves other accounts unaffected', async () => {
      const harness = await createIntegrationHarness({
        env: {
          LIMIT_WORKSPACES_PER_ACCOUNT: '1',
        },
      });
      harnesses.push(harness);
      await harness.resetDatabase();

      const user1 = await harness.signIn('user1-ws@local.com', 'User 1');
      const user2 = await harness.signIn('user2-ws@local.com', 'User 2');

      // User 1 creates first workspace -> 201
      const res1 = await harness
        .request()
        .post('/api/workspaces')
        .set('Cookie', user1.cookie)
        .send(workspaceBody('User 1 WS 1'));
      expect(res1.status).toBe(201);

      // User 1 attempts second workspace -> 403 LIMIT_REACHED
      const res2 = await harness
        .request()
        .post('/api/workspaces')
        .set('Cookie', user1.cookie)
        .send(workspaceBody('User 1 WS 2'));
      expect(res2.status).toBe(403);
      expect(res2.body).toMatchObject({
        code: 'LIMIT_REACHED',
        limit: 'workspaces',
      });
      expect(res2.body.message).toContain('allows 1 workspace per account');

      // User 2 creates their first workspace -> unaffected, 201
      const res3 = await harness
        .request()
        .post('/api/workspaces')
        .set('Cookie', user2.cookie)
        .send(workspaceBody('User 2 WS 1'));
      expect(res3.status).toBe(201);
    });
  });

  describe('Board limit (LIMIT_BOARDS_PER_ACCOUNT)', () => {
    it('counts boards against the workspace owner including collaborator creations', async () => {
      const harness = await createIntegrationHarness({
        env: {
          LIMIT_BOARDS_PER_ACCOUNT: '2',
        },
      });
      harnesses.push(harness);
      await harness.resetDatabase();

      const owner = await harness.signIn('owner-boards@local.com', 'Owner');
      const editor = await harness.signIn('editor-boards@local.com', 'Editor');

      // Setup workspace and project
      const ws = await harness.seedWorkspace({ name: 'Limit Workspace' });
      await harness.seedMember({
        organizationId: ws.id,
        userId: owner.user.id,
        role: 'owner',
        encryptedOrgKey: V1_WRAPPED_KEY,
      });
      await harness.seedMember({
        organizationId: ws.id,
        userId: editor.user.id,
        role: 'editor',
        encryptedOrgKey: V1_WRAPPED_KEY,
      });
      const project = await harness.seedProject({
        organizationId: ws.id,
        name: 'Main Project',
      });
      await harness.seedProjectMember({
        projectId: project.id,
        userId: editor.user.id,
        role: 'editor',
        encryptedProjectKey: V1_WRAPPED_KEY,
      });

      // Board 1 created by owner -> 201
      const b1 = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', owner.cookie)
        .set('active-organization', ws.id)
        .send(boardBody(project.id, 'Board 1'));
      expect(b1.status).toBe(201);

      // Board 2 created by editor -> 201 (counts against owner)
      const b2 = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', editor.cookie)
        .set('active-organization', ws.id)
        .send(boardBody(project.id, 'Board 2'));
      expect(b2.status).toBe(201);

      // Board 3 attempted by editor -> 403 LIMIT_REACHED
      const b3Editor = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', editor.cookie)
        .set('active-organization', ws.id)
        .send(boardBody(project.id, 'Board 3 by Editor'));
      expect(b3Editor.status).toBe(403);
      expect(b3Editor.body).toMatchObject({
        code: 'LIMIT_REACHED',
        limit: 'boards',
      });

      // Board 3 attempted by owner -> 403 LIMIT_REACHED
      const b3Owner = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', owner.cookie)
        .set('active-organization', ws.id)
        .send(boardBody(project.id, 'Board 3 by Owner'));
      expect(b3Owner.status).toBe(403);
      expect(b3Owner.body).toMatchObject({
        code: 'LIMIT_REACHED',
        limit: 'boards',
      });
    });
  });

  describe('Storage limit (LIMIT_STORAGE_MB_PER_ACCOUNT)', () => {
    it('enforces total storage limit but always allows shrinking saves', async () => {
      const harness = await createIntegrationHarness({
        env: {
          LIMIT_STORAGE_MB_PER_ACCOUNT: '1', // 1 MB limit (1,048,576 bytes)
        },
      });
      harnesses.push(harness);
      await harness.resetDatabase();

      const owner = await harness.signIn('storage-owner@local.com', 'Owner');

      const ws = await harness.seedWorkspace({ name: 'Storage Workspace' });
      await harness.seedMember({
        organizationId: ws.id,
        userId: owner.user.id,
        role: 'owner',
        encryptedOrgKey: V1_WRAPPED_KEY,
      });
      const project = await harness.seedProject({
        organizationId: ws.id,
        name: 'Storage Project',
      });
      const board = await harness.seedBoard({
        projectId: project.id,
        title: 'Storage Board',
        keyVersion: 1,
      });

      // 600 KB payload -> within 1 MB limit -> 200
      const payload600k = sizedPayload(600 * 1024, 1, 1);
      const resPayload1 = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', ws.id)
        .set('x-board-revision', '0')
        .set('Content-Type', 'application/octet-stream')
        .send(payload600k);
      expect(resPayload1.status).toBe(200);

      // Verify payloadBytes updated on board row
      const boardRow = await harness.prisma.board.findUniqueOrThrow({ where: { id: board.id } });
      expect(boardRow.payloadBytes).toBe(600 * 1024);

      // Attempt to upload 500 KB image file (600 KB + 500 KB = 1100 KB > 1024 KB) -> 403 LIMIT_REACHED
      const fileId = randomUUID();
      const file500k = sizedFile(500 * 1024, 1);
      const resFileRefused = await harness
        .request()
        .put(`/api/boards/${board.id}/files/${fileId}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', ws.id)
        .set('Content-Type', 'application/octet-stream')
        .send(file500k);
      expect(resFileRefused.status).toBe(403);
      expect(resFileRefused.body).toMatchObject({
        code: 'LIMIT_REACHED',
        limit: 'storage',
      });

      // Upload 300 KB image file (600 KB + 300 KB = 900 KB <= 1024 KB) -> 200 OK
      const file300k = sizedFile(300 * 1024, 1);
      const resFileOk = await harness
        .request()
        .put(`/api/boards/${board.id}/files/${fileId}`)
        .set('Cookie', owner.cookie)
        .set('active-organization', ws.id)
        .set('Content-Type', 'application/octet-stream')
        .send(file300k);
      expect(resFileOk.status).toBe(200);

      // Shrinking payload save: save 400 KB payload (deltaBytes = 400 - 600 = -200 KB) -> 200 OK
      const payload400k = sizedPayload(400 * 1024, 1, 2);
      const resShrink = await harness
        .request()
        .put(`/api/boards/${board.id}/payload`)
        .set('Cookie', owner.cookie)
        .set('active-organization', ws.id)
        .set('x-board-revision', '1')
        .set('Content-Type', 'application/octet-stream')
        .send(payload400k);
      expect(resShrink.status).toBe(200);
      expect(resShrink.body.revision).toBe(2);

      const boardAfterShrink = await harness.prisma.board.findUniqueOrThrow({
        where: { id: board.id },
      });
      expect(boardAfterShrink.payloadBytes).toBe(400 * 1024);
    });
  });

  describe('Demo mode (DEMO_MODE=true)', () => {
    it('creates throwaway anonymous accounts and enforces tenant isolation between visitors', async () => {
      const harness = await createIntegrationHarness({
        env: {
          DEMO_MODE: 'true',
          ENABLE_DEV_LOGIN: 'false',
        },
      });
      harnesses.push(harness);
      await harness.resetDatabase();

      // Config endpoint exposes demoMode: true and empty providers
      const configRes = await harness.request().get('/api/auth/config');
      expect(configRes.status).toBe(200);
      expect(configRes.body).toMatchObject({
        demoMode: true,
        providers: [],
      });

      // Helper to do anonymous sign-in
      const signInAnonymous = async () => {
        const res = await harness.request().post('/api/auth/sign-in/anonymous').send({});
        expect(res.status).toBe(200);
        const rawSetCookie = res.headers['set-cookie'];
        const cookieList = Array.isArray(rawSetCookie)
          ? rawSetCookie
          : rawSetCookie
            ? [rawSetCookie]
            : [];
        const cookie = cookieList.map((c) => c.split(';')[0]).join('; ');
        return { cookie, user: res.body.user };
      };

      const visitor1 = await signInAnonymous();
      expect(visitor1.user).toBeDefined();

      const visitor2 = await signInAnonymous();
      expect(visitor2.user).toBeDefined();
      expect(visitor2.user.id).not.toBe(visitor1.user.id);

      // Visitor 1 creates workspace and board
      const ws1Res = await harness
        .request()
        .post('/api/workspaces')
        .set('Cookie', visitor1.cookie)
        .send(workspaceBody('Visitor 1 WS'));
      expect(ws1Res.status).toBe(201);
      const ws1 = ws1Res.body;

      // Visitor 2 cannot access Visitor 1's workspace
      const v2AccessRes = await harness
        .request()
        .get(`/api/workspaces/${ws1.id}`)
        .set('Cookie', visitor2.cookie)
        .set('active-organization', ws1.id);
      expect([403, 404]).toContain(v2AccessRes.status);
    });
  });

  describe('Signup limit (LIMIT_SIGNUPS_PER_IP) and the client address', () => {
    const visit = (harness: IntegrationHarness, forwardedFor: string) =>
      harness
        .request()
        .post('/api/auth/sign-in/anonymous')
        .set('X-Forwarded-For', forwardedFor)
        .set('x-canvhq-client-ip', forwardedFor)
        .send({});

    it('ignores a client-chosen address when TRUST_PROXY is off', async () => {
      const harness = await createIntegrationHarness({
        env: { DEMO_MODE: 'true', ENABLE_DEV_LOGIN: 'false', LIMIT_SIGNUPS_PER_IP: '2' },
      });
      harnesses.push(harness);
      await harness.resetDatabase();

      expect((await visit(harness, '203.0.113.1')).status).toBe(200);
      expect((await visit(harness, '203.0.113.2')).status).toBe(200);
      const refused = await visit(harness, '203.0.113.3');
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'LIMIT_REACHED', limit: 'signups' });
      expect(await harness.prisma.user.count()).toBe(2);
    });

    it('counts the address the proxy reports when TRUST_PROXY is 1', async () => {
      const harness = await createIntegrationHarness({
        env: {
          DEMO_MODE: 'true',
          ENABLE_DEV_LOGIN: 'false',
          LIMIT_SIGNUPS_PER_IP: '1',
          TRUST_PROXY: '1',
        },
      });
      harnesses.push(harness);
      await harness.resetDatabase();

      expect((await visit(harness, '203.0.113.1')).status).toBe(200);
      expect((await visit(harness, '203.0.113.1')).status).toBe(403);
      expect((await visit(harness, '203.0.113.2')).status).toBe(200);
    });
  });

  describe('First account email gate (FIRST_ACCOUNT_EMAIL)', () => {
    // Dev login writes users directly and never reaches Better Auth's user-create hook, which is
    // where the gate lives. Creating the user through Better Auth's own OAuth path runs the hook
    // exactly as a provider callback would.
    async function registerWithProvider(
      harness: IntegrationHarness,
      email: string,
      emailVerified = true,
    ) {
      const { $context } = harness.app.get(AUTH);
      const { internalAdapter } = await $context;
      return internalAdapter.createOAuthUser(
        { email, name: email, emailVerified },
        { providerId: 'github', accountId: randomUUID() },
      );
    }

    async function rowsLeftBehind(harness: IntegrationHarness) {
      return [
        await harness.prisma.user.count(),
        await harness.prisma.account.count(),
        await harness.prisma.session.count(),
        await harness.prisma.organization.count(),
      ];
    }

    const closedFromTheStart = {
      FIRST_ACCOUNT_EMAIL: 'operator@canvhq.internal',
      ALLOW_SIGNUPS: 'false',
    };

    it('lets the configured address register first, in any letter case', async () => {
      const harness = await createIntegrationHarness({ env: closedFromTheStart });
      harnesses.push(harness);
      await harness.resetDatabase();

      const { user } = await registerWithProvider(harness, 'OPERATOR@Canvhq.Internal');

      expect(user.email).toBe('operator@canvhq.internal');
      expect(await harness.prisma.user.count()).toBe(1);
    });

    it('refuses another address and an unverified one, leaving nothing behind', async () => {
      const harness = await createIntegrationHarness({ env: closedFromTheStart });
      harnesses.push(harness);
      await harness.resetDatabase();

      await expect(registerWithProvider(harness, 'stranger@local.com')).rejects.toMatchObject({
        message:
          'This instance only accepts its first account from the address its operator set up.',
      });
      await expect(
        registerWithProvider(harness, 'operator@canvhq.internal', false),
      ).rejects.toMatchObject({ status: 'FORBIDDEN' });

      expect(await rowsLeftBehind(harness)).toEqual([0, 0, 0, 0]);
    });

    it('stops gating once a user exists, so the normal signup rules apply', async () => {
      const harness = await createIntegrationHarness({ env: closedFromTheStart });
      harnesses.push(harness);
      await harness.resetDatabase();
      await registerWithProvider(harness, 'operator@canvhq.internal');

      await expect(registerWithProvider(harness, 'stranger@local.com')).rejects.toMatchObject({
        message: expect.stringContaining('Public registration is currently disabled'),
      });
      expect(await harness.prisma.user.count()).toBe(1);

      const open = await createIntegrationHarness({
        env: { FIRST_ACCOUNT_EMAIL: 'operator@canvhq.internal', ALLOW_SIGNUPS: 'true' },
      });
      harnesses.push(open);
      await open.resetDatabase();
      await registerWithProvider(open, 'operator@canvhq.internal');
      await registerWithProvider(open, 'second@local.com');
      expect(await open.prisma.user.count()).toBe(2);
    });

    it('leaves today’s behaviour alone when the variable is unset', async () => {
      const harness = await createIntegrationHarness({ env: { ALLOW_SIGNUPS: 'false' } });
      harnesses.push(harness);
      await harness.resetDatabase();

      await registerWithProvider(harness, 'whoever@local.com');
      await expect(registerWithProvider(harness, 'next@local.com')).rejects.toMatchObject({
        status: 'FORBIDDEN',
      });
    });
  });
});
