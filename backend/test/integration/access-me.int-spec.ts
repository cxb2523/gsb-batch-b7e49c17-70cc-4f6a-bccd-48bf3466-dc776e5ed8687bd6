import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMongoAbility, type RawRuleOf } from '@casl/ability';
import { unpackRules, type PackRule } from '@casl/ability/extra';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import {
  defineAbilityFor,
  type AccessAction,
  type AccessSubject,
  type AppAbility,
} from '../../src/access/abilities.js';
import type { ProjectRole, WorkspaceRole } from '../../src/access/roles.js';

/**
 * The endpoint batch 15 will use: the caller's own packed rules, produced by the same
 * `defineAbilityFor` the guard uses.
 */
describe('Access rules endpoint (Integration)', () => {
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

  const ACTIONS: AccessAction[] = [
    'read',
    'create',
    'update',
    'delete',
    'share',
    'transfer',
    'manage',
  ];
  const SUBJECTS: AccessSubject[] = [
    'Workspace',
    'Member',
    'Invitation',
    'Project',
    'ProjectMember',
    'Board',
    'all',
  ];

  function unpackedAbility(packed: PackRule<RawRuleOf<AppAbility>>[]): AppAbility {
    const ability = createMongoAbility<[AccessAction, AccessSubject]>();
    ability.update(unpackRules<RawRuleOf<AppAbility>>(packed));
    return ability;
  }

  function expectSameBehaviour(actual: AppAbility, expected: AppAbility): void {
    for (const action of ACTIONS) {
      for (const subject of SUBJECTS) {
        expect(actual.can(action, subject), `${action} ${subject}`).toBe(
          expected.can(action, subject),
        );
      }
    }
  }

  async function scenario() {
    const owner = await harness.signIn('rules-owner@local.com', 'Rules Owner');
    const admin = await harness.signIn('rules-admin@local.com', 'Rules Admin');
    const editor = await harness.signIn('rules-editor@local.com', 'Rules Editor');
    const viewer = await harness.signIn('rules-viewer@local.com', 'Rules Viewer');

    const workspace = await harness.seedWorkspace({ name: 'Rules Lab' });
    const roles: Array<[SignedInActor, WorkspaceRole]> = [
      [owner, 'owner'],
      [admin, 'admin'],
      [editor, 'editor'],
      [viewer, 'viewer'],
    ];
    await Promise.all(
      roles.map(([actor, role]) =>
        harness.seedMember({ organizationId: workspace.id, userId: actor.user.id, role }),
      ),
    );

    const project = await harness.seedProject({
      organizationId: workspace.id,
      name: 'Rules Project',
    });
    await harness.seedProjectMember({
      projectId: project.id,
      userId: editor.user.id,
      role: 'editor',
    });
    await harness.seedProjectMember({
      projectId: project.id,
      userId: viewer.user.id,
      role: 'viewer',
    });

    return { owner, admin, editor, viewer, workspace, project };
  }

  const getMe = (actor: SignedInActor, workspace?: string) =>
    harness
      .request()
      .get(`/api/access/me${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`)
      .set('Cookie', actor.cookie);

  it('access/me: returns the caller creation right without a workspace', async () => {
    const fresh = await harness.signIn('rules-fresh@local.com', 'Fresh');
    const freshRes = await getMe(fresh);
    expect(freshRes.status).toBe(200);
    expect(freshRes.body).toEqual({ canCreateWorkspace: true });

    const editorOnly = await harness.signIn('rules-editor-only@local.com', 'Editor Only');
    const workspace = await harness.seedWorkspace({ name: 'Elsewhere' });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: editorOnly.user.id,
      role: 'editor',
    });

    const editorRes = await getMe(editorOnly);
    expect(editorRes.status).toBe(200);
    expect(editorRes.body).toEqual({ canCreateWorkspace: false });
  });

  it('access/me: packed workspace rules answer exactly as defineAbilityFor for every role', async () => {
    const { owner, admin, editor, viewer, workspace } = await scenario();
    const actors: Array<[SignedInActor, WorkspaceRole]> = [
      [owner, 'owner'],
      [admin, 'admin'],
      [editor, 'editor'],
      [viewer, 'viewer'],
    ];

    const responses = await Promise.all(
      actors.map(async ([actor, role]) => ({
        role,
        res: await getMe(actor, workspace.slug ?? workspace.id),
      })),
    );

    for (const { role, res } of responses) {
      expect(res.status).toBe(200);
      expect(res.body.workspace).toEqual({ id: workspace.id, slug: workspace.slug });
      expect(res.body.workspaceRole).toBe(role);
      expect(res.body.isWorkspaceAdministrator).toBe(role === 'owner' || role === 'admin');
      expect(res.body.canCreateWorkspace).toBe(role === 'owner' || role === 'admin');

      expectSameBehaviour(
        unpackedAbility(res.body.rules),
        defineAbilityFor({ workspaceRole: role, projectRole: null }),
      );
    }
  });

  it('access/me: packed project rules answer exactly as defineAbilityFor for all three roles', async () => {
    const { owner, workspace } = await scenario();

    const res = await getMe(owner, workspace.slug ?? workspace.id);
    expect(res.status).toBe(200);

    for (const role of ['admin', 'editor', 'viewer'] as ProjectRole[]) {
      expectSameBehaviour(
        unpackedAbility(res.body.projectRules[role]),
        defineAbilityFor({
          workspaceRole: 'owner',
          projectRole: role,
          isAssignedToProject: true,
        }),
      );
    }

    // The same comparison for a non-administrator, whose workspace-level rules and project rules
    // are built from a different workspace role.
    const viewer = await harness.signIn('rules-viewer-2@local.com', 'Rules Viewer 2');
    await harness.seedMember({
      organizationId: workspace.id,
      userId: viewer.user.id,
      role: 'viewer',
    });
    const viewerRes = await getMe(viewer, workspace.slug ?? workspace.id);
    for (const role of ['admin', 'editor', 'viewer'] as ProjectRole[]) {
      expectSameBehaviour(
        unpackedAbility(viewerRes.body.projectRules[role]),
        defineAbilityFor({
          workspaceRole: 'viewer',
          projectRole: role,
          isAssignedToProject: true,
        }),
      );
    }
  });

  it('access/me: reports the caller own project roles and no one else’s', async () => {
    const { editor, viewer, workspace, project } = await scenario();

    const editorRes = await getMe(editor, workspace.slug ?? workspace.id);
    expect(editorRes.status).toBe(200);
    expect(editorRes.body.projectRoles).toEqual({ [project.id]: 'editor' });

    const viewerRes = await getMe(viewer, workspace.slug ?? workspace.id);
    expect(viewerRes.status).toBe(200);
    expect(viewerRes.body.projectRoles).toEqual({ [project.id]: 'viewer' });
  });

  it('access/me: refuses a caller who is not a member of the requested workspace', async () => {
    const { workspace } = await scenario();
    const stranger = await harness.signIn('rules-stranger@local.com', 'Stranger');

    const res = await getMe(stranger, workspace.slug ?? workspace.id);

    expect(res.status).toBe(403);
  });

  it('access/me: an id is never shadowed by a slug that equals it', async () => {
    const { owner, workspace } = await scenario();

    // Another workspace whose slug is exactly the first workspace's id.
    await harness.seedWorkspace({ name: 'Squatter', slug: workspace.id });

    const res = await getMe(owner, workspace.id);

    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(workspace.id);
  });
});
