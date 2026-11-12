import { describe, it, expect } from 'vitest';
import { canCreateWorkspace } from './workspace-creation.js';

describe('canCreateWorkspace', () => {
  it('allows a user with no memberships to create their first workspace', () => {
    expect(canCreateWorkspace([])).toBe(true);
  });

  it('allows an owner or an admin elsewhere to create another workspace', () => {
    expect(canCreateWorkspace([{ role: 'owner' }])).toBe(true);
    expect(canCreateWorkspace([{ role: 'admin' }])).toBe(true);
  });

  it('refuses a user whose only roles are editor or viewer', () => {
    expect(canCreateWorkspace([{ role: 'editor' }])).toBe(false);
    expect(canCreateWorkspace([{ role: 'viewer' }])).toBe(false);
    expect(canCreateWorkspace([{ role: 'editor' }, { role: 'viewer' }])).toBe(false);
  });

  it('allows a user who is an editor somewhere and an admin somewhere else', () => {
    expect(canCreateWorkspace([{ role: 'editor' }, { role: 'admin' }])).toBe(true);
  });

  it('refuses when owned workspaces count reaches limitWorkspacesPerAccount', () => {
    expect(canCreateWorkspace([{ role: 'owner' }], 1)).toBe(false);
    expect(canCreateWorkspace([{ role: 'owner' }, { role: 'admin' }], 2)).toBe(true);
    expect(canCreateWorkspace([{ role: 'owner' }, { role: 'owner' }], 2)).toBe(false);
    expect(canCreateWorkspace([], 1)).toBe(true);
  });
});
