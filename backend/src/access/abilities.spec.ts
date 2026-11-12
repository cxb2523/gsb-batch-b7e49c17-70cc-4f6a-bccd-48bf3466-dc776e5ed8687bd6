import { describe, it, expect } from 'vitest';
import {
  canActOnMember,
  defineAbilityFor,
  type AccessAction,
  type AccessSubject,
} from './abilities.js';
import type { ProjectRole, WorkspaceRole } from './roles.js';

type Context = {
  workspaceRole: WorkspaceRole | null;
  projectRole: ProjectRole | null;
  isAssignedToProject: boolean;
};

const WORKSPACE_ROLES: Array<WorkspaceRole | null> = [null, 'owner', 'admin', 'editor', 'viewer'];

/**
 * The project contexts a request can be in: no project at all, an assignment at each project
 * role, an assignment whose role is not recognised, and "projectRole set but not assigned"
 * (a malformed state that must never grant anything).
 */
const PROJECT_CONTEXTS: Array<Omit<Context, 'workspaceRole'>> = [
  { projectRole: null, isAssignedToProject: false },
  { projectRole: 'admin', isAssignedToProject: true },
  { projectRole: 'editor', isAssignedToProject: true },
  { projectRole: 'viewer', isAssignedToProject: true },
  { projectRole: null, isAssignedToProject: true },
  { projectRole: 'editor', isAssignedToProject: false },
];

const CONTEXTS: Context[] = [];
for (const workspaceRole of WORKSPACE_ROLES) {
  for (const project of PROJECT_CONTEXTS) {
    CONTEXTS.push({
      workspaceRole,
      projectRole: project.projectRole,
      isAssignedToProject: project.isAssignedToProject,
    });
  }
}

type Rule = {
  action: AccessAction;
  subject: Exclude<AccessSubject, 'all'>;
  /** Hand-written independently of the ability implementation. */
  allowed: (context: Context) => boolean;
};

const hasWorkspace = (c: Context): boolean => c.workspaceRole !== null;
const isProjectMember = (c: Context): boolean =>
  hasWorkspace(c) && c.isAssignedToProject && c.projectRole !== null;
const isWorkspaceAdmin = (c: Context): boolean =>
  c.workspaceRole === 'owner' || c.workspaceRole === 'admin';
const isWorkspaceOwner = (c: Context): boolean => c.workspaceRole === 'owner';
const isProjectAdmin = (c: Context): boolean =>
  hasWorkspace(c) && c.isAssignedToProject && c.projectRole === 'admin';
const canWriteBoards = (c: Context): boolean =>
  isWorkspaceAdmin(c) ||
  (hasWorkspace(c) &&
    c.isAssignedToProject &&
    (c.projectRole === 'admin' || c.projectRole === 'editor'));

/** The target table from the batch, one row per subject and action. */
const RULES: Rule[] = [
  { action: 'read', subject: 'Workspace', allowed: (c) => c.workspaceRole !== null },
  { action: 'update', subject: 'Workspace', allowed: isWorkspaceAdmin },
  { action: 'delete', subject: 'Workspace', allowed: isWorkspaceOwner },
  { action: 'transfer', subject: 'Workspace', allowed: isWorkspaceOwner },

  { action: 'read', subject: 'Member', allowed: isWorkspaceAdmin },
  { action: 'update', subject: 'Member', allowed: isWorkspaceAdmin },
  { action: 'delete', subject: 'Member', allowed: isWorkspaceAdmin },

  { action: 'create', subject: 'Invitation', allowed: isWorkspaceAdmin },
  { action: 'read', subject: 'Invitation', allowed: isWorkspaceAdmin },
  { action: 'delete', subject: 'Invitation', allowed: isWorkspaceAdmin },

  { action: 'create', subject: 'Project', allowed: isWorkspaceAdmin },
  { action: 'read', subject: 'Project', allowed: (c) => isWorkspaceAdmin(c) || isProjectMember(c) },
  {
    action: 'update',
    subject: 'Project',
    allowed: (c) => isWorkspaceAdmin(c) || isProjectAdmin(c),
  },
  { action: 'delete', subject: 'Project', allowed: isWorkspaceAdmin },

  {
    action: 'read',
    subject: 'ProjectMember',
    allowed: (c) => isWorkspaceAdmin(c) || isProjectMember(c),
  },
  {
    action: 'manage',
    subject: 'ProjectMember',
    allowed: (c) => isWorkspaceAdmin(c) || isProjectAdmin(c),
  },

  { action: 'read', subject: 'Board', allowed: (c) => isWorkspaceAdmin(c) || isProjectMember(c) },
  { action: 'create', subject: 'Board', allowed: canWriteBoards },
  { action: 'update', subject: 'Board', allowed: canWriteBoards },
  { action: 'delete', subject: 'Board', allowed: canWriteBoards },
  { action: 'share', subject: 'Board', allowed: canWriteBoards },
];

const ALL_ACTIONS: AccessAction[] = [
  'read',
  'create',
  'update',
  'delete',
  'share',
  'transfer',
  'manage',
];
const ALL_SUBJECTS: Array<Exclude<AccessSubject, 'all'>> = [
  'Workspace',
  'Member',
  'Invitation',
  'Project',
  'ProjectMember',
  'Board',
];

/**
 * The expected answer for any pair, including pairs the table does not name: a `manage` rule
 * grants every action on its subject, and everything else is denied.
 */
function expectedFor(context: Context, action: AccessAction, subject: string): boolean {
  const direct = RULES.find((rule) => rule.action === action && rule.subject === subject);
  if (direct) return direct.allowed(context);

  if (action !== 'manage') {
    const manage = RULES.find((rule) => rule.action === 'manage' && rule.subject === subject);
    if (manage) return manage.allowed(context);
  }

  return false;
}

describe('defineAbilityFor', () => {
  it('checks every action against every subject for every role combination', () => {
    expect(CONTEXTS).toHaveLength(30);

    for (const context of CONTEXTS) {
      const ability = defineAbilityFor(context);
      for (const action of ALL_ACTIONS) {
        for (const subject of ALL_SUBJECTS) {
          const label = `${JSON.stringify(context)} -> ${action} ${subject}`;
          expect(ability.can(action, subject), label).toBe(expectedFor(context, action, subject));
        }
      }
    }
  });

  it('never grants an action on the wildcard subject', () => {
    for (const context of CONTEXTS) {
      const ability = defineAbilityFor(context);
      for (const action of ALL_ACTIONS) {
        expect(ability.can(action, 'all')).toBe(false);
      }
    }
  });

  it('gives nobody anything without a workspace role', () => {
    const ability = defineAbilityFor({
      workspaceRole: null,
      projectRole: 'admin',
      isAssignedToProject: true,
    });

    for (const rule of RULES) {
      expect(ability.can(rule.action, rule.subject)).toBe(false);
    }
  });

  it('lets an unassigned workspace editor read the workspace and nothing else', () => {
    const ability = defineAbilityFor({
      workspaceRole: 'editor',
      projectRole: null,
      isAssignedToProject: false,
    });

    expect(ability.can('read', 'Workspace')).toBe(true);
    expect(ability.can('create', 'Project')).toBe(false);
    expect(ability.can('read', 'Project')).toBe(false);
    expect(ability.can('read', 'Board')).toBe(false);
  });

  it('never lets a project assignment exceed the project role', () => {
    const editor = defineAbilityFor({
      workspaceRole: 'editor',
      projectRole: 'editor',
      isAssignedToProject: true,
    });
    expect(editor.can('update', 'Project')).toBe(false);
    expect(editor.can('manage', 'ProjectMember')).toBe(false);
    expect(editor.can('share', 'Board')).toBe(true);

    const viewer = defineAbilityFor({
      workspaceRole: 'viewer',
      projectRole: 'viewer',
      isAssignedToProject: true,
    });
    expect(viewer.can('read', 'Board')).toBe(true);
    expect(viewer.can('update', 'Board')).toBe(false);
    expect(viewer.can('share', 'Board')).toBe(false);
  });
});

describe('canActOnMember', () => {
  it('lets any administrator change or remove a non-owner', () => {
    expect(canActOnMember('owner', 'editor')).toBe(true);
    expect(canActOnMember('admin', 'viewer')).toBe(true);
    expect(canActOnMember('admin', 'editor')).toBe(true);
  });

  it('never lets anyone change or remove an owner through the member routes', () => {
    expect(canActOnMember('owner', 'owner')).toBe(false);
    expect(canActOnMember('admin', 'owner')).toBe(false);
    expect(canActOnMember('editor', 'owner')).toBe(false);
  });

  it('grants nothing to a non-administrator', () => {
    expect(canActOnMember('editor', 'viewer')).toBe(false);
    expect(canActOnMember('viewer', 'viewer')).toBe(false);
    expect(canActOnMember(null, 'viewer')).toBe(false);
  });
});
