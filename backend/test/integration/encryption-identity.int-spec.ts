import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import { randomUUID } from 'node:crypto';
import { V1_WRAPPED_KEY } from './fixtures.js';

/**
 * H5 and C4 over the real database: identity set-up happens once (even under a concurrent
 * double click), public keys are visible only to workspace-mates, and no project or board can
 * be created without its wrapped keys.
 */
describe('Encryption identity and required keys (Integration)', () => {
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

  const identityBody = (suffix: string) => ({
    kdfSalt: `salt-${suffix}`,
    keyWrapIv: `iv-${suffix}`,
    wrappedPrivateKey: `wrapped-${suffix}`,
    publicKey: `public-${suffix}`,
  });

  const setupEncryption = (actor: SignedInActor, suffix: string) =>
    harness
      .request()
      .post('/api/user/encryption-setup')
      .set('Cookie', actor.cookie)
      .send(identityBody(suffix));

  async function seedWorkspaceWithMembers(
    members: Array<{ actor: SignedInActor; role: 'owner' | 'admin' | 'editor' | 'viewer' }>,
  ) {
    const workspace = await harness.seedWorkspace({ name: 'Identity Lab' });
    await Promise.all(
      members.map((member) =>
        harness.seedMember({
          organizationId: workspace.id,
          userId: member.actor.user.id,
          role: member.role,
        }),
      ),
    );
    return workspace;
  }

  describe('setupEncryption', () => {
    it('runs once and the first key pair survives a second attempt', async () => {
      const user = await harness.signIn('identity-once@local.com', 'Identity Once');

      const first = await setupEncryption(user, 'first');
      expect(first.status).toBe(201);

      const second = await setupEncryption(user, 'second');
      expect(second.status).toBe(409);

      const stored = await harness.prisma.user.findUniqueOrThrow({
        where: { id: user.user.id },
        select: { publicKey: true, wrappedPrivateKey: true, kdfSalt: true },
      });
      expect(stored.publicKey).toBe('public-first');
      expect(stored.wrappedPrivateKey).toBe('wrapped-first');
      expect(stored.kdfSalt).toBe('salt-first');
    });

    it('lets only one of two concurrent set-ups win', async () => {
      const user = await harness.signIn('identity-race@local.com', 'Identity Race');

      const results = await Promise.all([
        setupEncryption(user, 'race-a'),
        setupEncryption(user, 'race-b'),
      ]);
      const statuses = results.map((result) => result.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const winner = results.find((result) => result.status === 201);
      expect(winner).toBeDefined();
      const winningSuffix = winner?.body?.publicKey === 'public-race-a' ? 'race-a' : 'race-b';

      const stored = await harness.prisma.user.findUniqueOrThrow({
        where: { id: user.user.id },
        select: { publicKey: true, wrappedPrivateKey: true },
      });
      expect(stored.publicKey).toBe(`public-${winningSuffix}`);
      expect(stored.wrappedPrivateKey).toBe(`wrapped-${winningSuffix}`);
    });
  });

  describe('GET /api/user/public-key/:id', () => {
    it('returns only the id and public key to its owner', async () => {
      const user = await harness.signIn('identity-self@local.com', 'Identity Self');
      await setupEncryption(user, 'self');

      const res = await harness
        .request()
        .get(`/api/user/public-key/${user.user.id}`)
        .set('Cookie', user.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.user.id, publicKey: 'public-self' });
      expect(Object.keys(res.body).sort()).toEqual(['id', 'publicKey']);
    });

    it('is visible to a colleague in the same workspace', async () => {
      const owner = await harness.signIn('identity-owner@local.com', 'Identity Owner');
      const colleague = await harness.signIn('identity-colleague@local.com', 'Identity Colleague');
      await seedWorkspaceWithMembers([
        { actor: owner, role: 'owner' },
        { actor: colleague, role: 'editor' },
      ]);
      await setupEncryption(owner, 'owner');

      const res = await harness
        .request()
        .get(`/api/user/public-key/${owner.user.id}`)
        .set('Cookie', colleague.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: owner.user.id, publicKey: 'public-owner' });
    });

    it('is hidden from a stranger and from a user who has no key', async () => {
      const owner = await harness.signIn('identity-hidden@local.com', 'Identity Hidden');
      const stranger = await harness.signIn('identity-stranger@local.com', 'Identity Stranger');
      await seedWorkspaceWithMembers([{ actor: owner, role: 'owner' }]);
      await setupEncryption(owner, 'hidden');

      const strangerRes = await harness
        .request()
        .get(`/api/user/public-key/${owner.user.id}`)
        .set('Cookie', stranger.cookie);
      expect(strangerRes.status).toBe(404);

      const keylessRes = await harness
        .request()
        .get(`/api/user/public-key/${stranger.user.id}`)
        .set('Cookie', owner.cookie);
      expect(keylessRes.status).toBe(404);
    });
  });

  describe('required keys', () => {
    it('refuses a project without both project keys and creates nothing', async () => {
      const owner = await harness.signIn('keys-project@local.com', 'Keys Project');
      const workspace = await seedWorkspaceWithMembers([{ actor: owner, role: 'owner' }]);

      const res = await harness
        .request()
        .post('/api/projects')
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .send({ name: 'Keyless Project' });

      expect(res.status).toBe(400);
      expect(await harness.prisma.project.count({ where: { organizationId: workspace.id } })).toBe(
        0,
      );
    });

    it('refuses a board without a wrapped key and creates nothing', async () => {
      const owner = await harness.signIn('keys-board@local.com', 'Keys Board');
      const workspace = await seedWorkspaceWithMembers([{ actor: owner, role: 'owner' }]);
      const project = await harness.seedProject({
        organizationId: workspace.id,
        name: 'Keyed Project',
        encryptedProjectKey: 'wrapped-project-key',
      });

      const res = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .send({ projectId: project.id, title: 'Keyless Board' });

      expect(res.status).toBe(400);
      expect(await harness.prisma.board.count({ where: { projectId: project.id } })).toBe(0);
    });

    it('creates the project and board when their keys are supplied', async () => {
      const owner = await harness.signIn('keys-ok@local.com', 'Keys Ok');
      const workspace = await seedWorkspaceWithMembers([{ actor: owner, role: 'owner' }]);

      const projectRes = await harness
        .request()
        .post('/api/projects')
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .send({
          id: randomUUID(),
          name: 'Keyed Project',
          encryptedProjectKey: V1_WRAPPED_KEY,
          creatorEncryptedProjectKey: V1_WRAPPED_KEY,
        });
      expect(projectRes.status).toBe(201);

      const boardRes = await harness
        .request()
        .post('/api/boards')
        .set('Cookie', owner.cookie)
        .set('active-organization', workspace.id)
        .send({
          id: randomUUID(),
          projectId: projectRes.body.id,
          title: 'Keyed Board',
          encryptedBoardKey: V1_WRAPPED_KEY,
          projectKeyVersion: 1,
        });
      expect(boardRes.status).toBe(201);
      expect(boardRes.body.encryptedBoardKey).toBe(V1_WRAPPED_KEY);
    });
  });
});
