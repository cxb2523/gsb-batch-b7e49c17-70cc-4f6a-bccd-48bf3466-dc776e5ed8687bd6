import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import type { UseQueryResult } from '@tanstack/react-query';
import { useAccess } from './useAccess';
import * as workspaceQueries from '@/features/workspaces/queries';
import type { AccessMe } from '@/features/workspaces/schemas';

function mockQueryResult(
  data: AccessMe | undefined,
  isLoading: boolean,
  isError = false,
): UseQueryResult<AccessMe, Error> {
  return {
    data,
    isLoading,
    isSuccess: !isLoading && Boolean(data),
    isError,
    status: isLoading ? 'pending' : 'success',
  } as unknown as UseQueryResult<AccessMe, Error>;
}

// Helper to construct CASL packed rules for testing
function buildPackedRules(
  callback: (can: (action: string | string[], subject: string | string[]) => void) => void,
) {
  const { can, build } = new AbilityBuilder<MongoAbility>(createMongoAbility);
  callback(can);
  return packRules(build().rules);
}

describe('useAccess hook', () => {
  const ownerWorkspaceRules = buildPackedRules((can) => {
    can('read', 'Workspace');
    can('update', 'Workspace');
    can('delete', 'Workspace');
    can('transfer', 'Workspace');
    can(['create', 'read', 'delete'], 'Invitation');
    can(['read', 'create', 'update', 'delete'], 'Project');
    can('read', 'Member');
    can('update', 'Member');
    can('delete', 'Member');
    can('manage', 'ProjectMember');
    can(['read', 'create', 'update', 'delete', 'share'], 'Board');
  });

  const adminWorkspaceRules = buildPackedRules((can) => {
    can('read', 'Workspace');
    can('update', 'Workspace');
    can(['create', 'read', 'delete'], 'Invitation');
    can(['read', 'create', 'update', 'delete'], 'Project');
    can('read', 'Member');
    can('update', 'Member');
    can('delete', 'Member');
    can('manage', 'ProjectMember');
    can(['read', 'create', 'update', 'delete', 'share'], 'Board');
  });

  const editorProjectRules = buildPackedRules((can) => {
    can('read', 'Project');
    can('read', 'ProjectMember');
    can(['read', 'create', 'update', 'delete', 'share'], 'Board');
  });

  const viewerProjectRules = buildPackedRules((can) => {
    can('read', 'Project');
    can('read', 'ProjectMember');
    can('read', 'Board');
  });

  const baseProjectRules = {
    admin: adminWorkspaceRules,
    editor: editorProjectRules,
    viewer: viewerProjectRules,
  };

  it('returns can() === false and null roles while loading', () => {
    vi.spyOn(workspaceQueries, 'useAccessMe').mockReturnValue(mockQueryResult(undefined, true));

    const { result } = renderHook(() => useAccess('acme-corp', 'proj-1'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.can('read', 'Workspace')).toBe(false);
    expect(result.current.can('read', 'Project')).toBe(false);
    expect(result.current.can('update', 'Board')).toBe(false);
    expect(result.current.role).toBeNull();
    expect(result.current.isAdministrator).toBe(false);
    expect(result.current.canCreateWorkspace).toBe(false);
  });

  it('grants nothing, and stops loading, when the server will not describe the workspace', () => {
    vi.spyOn(workspaceQueries, 'useAccessMe').mockReturnValue(
      mockQueryResult(undefined, false, true),
    );

    const { result } = renderHook(() => useAccess('someone-elses'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAdministrator).toBe(false);
    expect(result.current.can('read', 'Workspace')).toBe(false);
  });

  it('evaluates Owner permissions at workspace and project levels', () => {
    vi.spyOn(workspaceQueries, 'useAccessMe').mockReturnValue(
      mockQueryResult(
        {
          canCreateWorkspace: true,
          workspace: { id: 'w1', slug: 'acme-corp' },
          workspaceRole: 'owner',
          isWorkspaceAdministrator: true,
          rules: ownerWorkspaceRules,
          projectRules: baseProjectRules,
          projectRoles: { 'proj-1': 'admin' },
        },
        false,
      ),
    );

    // Workspace level
    const { result: wsResult } = renderHook(() => useAccess('acme-corp'));
    expect(wsResult.current.isLoading).toBe(false);
    expect(wsResult.current.role).toBe('owner');
    expect(wsResult.current.isAdministrator).toBe(true);
    expect(wsResult.current.canCreateWorkspace).toBe(true);
    expect(wsResult.current.can('update', 'Workspace')).toBe(true);
    expect(wsResult.current.can('delete', 'Workspace')).toBe(true);
    expect(wsResult.current.can('transfer', 'Workspace')).toBe(true);

    // Project level (Administrator uses workspace rules for all projects)
    const { result: projResult } = renderHook(() => useAccess('acme-corp', 'proj-1'));
    expect(projResult.current.role).toBe('admin');
    expect(projResult.current.isAdministrator).toBe(true);
    expect(projResult.current.can('delete', 'Project')).toBe(true);
    expect(projResult.current.can('create', 'Board')).toBe(true);
  });

  it('evaluates Admin permissions (can update but cannot delete or transfer workspace)', () => {
    vi.spyOn(workspaceQueries, 'useAccessMe').mockReturnValue(
      mockQueryResult(
        {
          canCreateWorkspace: true,
          workspace: { id: 'w1', slug: 'acme-corp' },
          workspaceRole: 'admin',
          isWorkspaceAdministrator: true,
          rules: adminWorkspaceRules,
          projectRules: baseProjectRules,
          projectRoles: {},
        },
        false,
      ),
    );

    const { result } = renderHook(() => useAccess('acme-corp'));
    expect(result.current.role).toBe('admin');
    expect(result.current.isAdministrator).toBe(true);
    expect(result.current.can('update', 'Workspace')).toBe(true);
    expect(result.current.can('delete', 'Workspace')).toBe(false);
    expect(result.current.can('transfer', 'Workspace')).toBe(false);

    // Admin on any project (even without explicit grant)
    const { result: projResult } = renderHook(() => useAccess('acme-corp', 'proj-any'));
    expect(projResult.current.role).toBe('admin');
    expect(projResult.current.isAdministrator).toBe(true);
    expect(projResult.current.can('manage', 'ProjectMember')).toBe(true);
  });

  it('evaluates Editor with project grant', () => {
    vi.spyOn(workspaceQueries, 'useAccessMe').mockReturnValue(
      mockQueryResult(
        {
          canCreateWorkspace: false,
          workspace: { id: 'w1', slug: 'acme-corp' },
          workspaceRole: 'editor',
          isWorkspaceAdministrator: false,
          rules: buildPackedRules((can) => {
            can('read', 'Workspace');
          }),
          projectRules: baseProjectRules,
          projectRoles: { 'proj-1': 'editor' },
        },
        false,
      ),
    );

    // Workspace level
    const { result: wsResult } = renderHook(() => useAccess('acme-corp'));
    expect(wsResult.current.role).toBe('editor');
    expect(wsResult.current.isAdministrator).toBe(false);
    expect(wsResult.current.canCreateWorkspace).toBe(false);
    expect(wsResult.current.can('update', 'Workspace')).toBe(false);
    expect(wsResult.current.can('create', 'Project')).toBe(false);

    // Project level
    const { result: projResult } = renderHook(() => useAccess('acme-corp', 'proj-1'));
    expect(projResult.current.role).toBe('editor');
    expect(projResult.current.can('read', 'Project')).toBe(true);
    expect(projResult.current.can('create', 'Board')).toBe(true);
    expect(projResult.current.can('manage', 'ProjectMember')).toBe(false);
  });

  it('evaluates Editor without a project grant (cannot read or access project)', () => {
    vi.spyOn(workspaceQueries, 'useAccessMe').mockReturnValue(
      mockQueryResult(
        {
          canCreateWorkspace: false,
          workspace: { id: 'w1', slug: 'acme-corp' },
          workspaceRole: 'editor',
          isWorkspaceAdministrator: false,
          rules: buildPackedRules((can) => {
            can('read', 'Workspace');
          }),
          projectRules: baseProjectRules,
          projectRoles: { 'proj-1': 'editor' }, // no grant for proj-2
        },
        false,
      ),
    );

    const { result } = renderHook(() => useAccess('acme-corp', 'proj-2'));
    expect(result.current.role).toBeNull();
    expect(result.current.isAdministrator).toBe(false);
    expect(result.current.can('read', 'Project')).toBe(false);
    expect(result.current.can('read', 'Board')).toBe(false);
    expect(result.current.can('create', 'Board')).toBe(false);
  });

  it('evaluates Viewer permissions on a project', () => {
    vi.spyOn(workspaceQueries, 'useAccessMe').mockReturnValue(
      mockQueryResult(
        {
          canCreateWorkspace: false,
          workspace: { id: 'w1', slug: 'acme-corp' },
          workspaceRole: 'viewer',
          isWorkspaceAdministrator: false,
          rules: buildPackedRules((can) => {
            can('read', 'Workspace');
          }),
          projectRules: baseProjectRules,
          projectRoles: { 'proj-view': 'viewer' },
        },
        false,
      ),
    );

    const { result } = renderHook(() => useAccess('acme-corp', 'proj-view'));
    expect(result.current.role).toBe('viewer');
    expect(result.current.can('read', 'Project')).toBe(true);
    expect(result.current.can('read', 'Board')).toBe(true);
    expect(result.current.can('create', 'Board')).toBe(false);
    expect(result.current.can('update', 'Board')).toBe(false);
  });
});
