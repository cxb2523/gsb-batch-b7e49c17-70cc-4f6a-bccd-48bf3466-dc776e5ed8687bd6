import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';

/**
 * What the API refuses to store, over real HTTP: a name with characters that are not allowed is
 * answered with 400 and the reason, and the stored value is left alone. The rule itself is tabled
 * in `test/names.spec.ts`; this checks that every route that takes a name applies it.
 */
describe('Input validation at the API (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let workspaceId: string;
  let projectId: string;
  let boardId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();

    owner = await harness.signIn('validation-owner@local.com', 'Valerie Owner');
    const workspace = await harness.seedWorkspace({ name: 'Acme' });
    workspaceId = workspace.id;
    await harness.seedMember({ organizationId: workspaceId, userId: owner.user.id, role: 'owner' });
    const project = await harness.seedProject({ organizationId: workspaceId, name: 'Roadmap' });
    projectId = project.id;
    const board = await harness.seedBoard({ projectId, title: 'Draft' });
    boardId = board.id;
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  const patch = (path: string, body: Record<string, unknown>) =>
    harness
      .request()
      .patch(path)
      .set('Cookie', owner.cookie)
      .set('active-organization', workspaceId)
      .send(body);

  describe.each([
    {
      what: 'a workspace name',
      path: () => `/api/workspaces/${workspaceId}`,
      field: 'name',
      message: /^Workspace name can only use letters/,
      stored: () =>
        harness.prisma.organization
          .findUniqueOrThrow({ where: { id: workspaceId } })
          .then((row) => row.name),
      good: 'Acme & Co. (EU)',
    },
    {
      what: 'a project name',
      path: () => `/api/projects/${projectId}`,
      field: 'name',
      message: /^Project name can only use letters/,
      stored: () =>
        harness.prisma.project
          .findUniqueOrThrow({ where: { id: projectId } })
          .then((row) => row.name),
      good: "Q3 Roadmap's Plan",
    },
    {
      what: 'a canvas title',
      path: () => `/api/boards/${boardId}`,
      field: 'title',
      message: /^Canvas title can only use letters/,
      stored: () =>
        harness.prisma.board.findUniqueOrThrow({ where: { id: boardId } }).then((row) => row.title),
      good: 'Network map 2',
    },
  ])('$what', ({ path, field, message, stored, good }) => {
    it.each(['Roadmap; DROP TABLE', 'Project-X', 'a/b', '<script>', 'Name: Draft', '😀 party'])(
      'refuses %j with the reason and changes nothing',
      async (bad) => {
        const before = await stored();

        const res = await patch(path(), { [field]: bad });

        expect(res.status).toBe(400);
        expect(res.body.errors?.[0]?.message ?? res.body.message).toMatch(message);
        expect(await stored()).toBe(before);
      },
    );

    it('refuses an empty name and one longer than 100 characters', async () => {
      expect((await patch(path(), { [field]: '   ' })).status).toBe(400);
      expect((await patch(path(), { [field]: 'a'.repeat(101) })).status).toBe(400);
    });

    it('accepts an ordinary name, trimmed', async () => {
      const res = await patch(path(), { [field]: `  ${good}  ` });

      expect(res.status).toBe(200);
      expect(await stored()).toBe(good);
    });
  });

  describe('a person name on the profile', () => {
    const profile = (name: string) =>
      harness.request().patch('/api/user/profile').set('Cookie', owner.cookie).send({ name });

    it('refuses characters that are not allowed, and keeps the stored name', async () => {
      const res = await profile('Valerie; DROP');

      expect(res.status).toBe(400);
      expect(res.body.errors?.[0]?.message ?? res.body.message).toMatch(
        /^Name can only use letters/,
      );
      const stored = await harness.prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } });
      expect(stored.name).toBe('Valerie Owner');
    });

    it('accepts a hyphen, an apostrophe and letters of any language', async () => {
      const names = ['Mary-Jane O’Brien', 'José Ángel', '李雷'];

      const statuses = await Promise.all(names.map(async (name) => (await profile(name)).status));

      expect(statuses).toEqual([200, 200, 200]);
    });
  });

  describe('an invitation', () => {
    const invite = (body: Record<string, unknown>) =>
      harness
        .request()
        .post(`/api/workspaces/${workspaceId}/members/invite`)
        .set('Cookie', owner.cookie)
        .set('active-organization', workspaceId)
        .send(body);

    it('refuses what is not an email address, or is far too long', async () => {
      expect((await invite({ email: 'not an email' })).status).toBe(400);
      expect((await invite({ email: `${'a'.repeat(250)}@acme.dev` })).status).toBe(400);
    });

    it('refuses a list of more than 100 projects', async () => {
      const projectIds = Array.from({ length: 101 }, (_, index) => `p${index}`);

      expect((await invite({ email: 'sam@acme.dev', projectIds })).status).toBe(400);
    });

    it('stores the address trimmed and in lower case', async () => {
      const res = await invite({ email: '  Sam.Lowercase@Acme.DEV ' });

      expect(res.status).toBe(201);
      const stored = await harness.prisma.invitation.findFirstOrThrow({
        where: { organizationId: workspaceId, email: 'sam.lowercase@acme.dev' },
      });
      expect(stored.email).toBe('sam.lowercase@acme.dev');
    });
  });
});
