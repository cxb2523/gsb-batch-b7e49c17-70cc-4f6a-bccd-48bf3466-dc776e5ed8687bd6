import { describe, it, expect } from 'vitest';
import { toBoardMetadata } from './board-metadata';

describe('toBoardMetadata', () => {
  it('fills in what a minimal board response leaves out', () => {
    const metadata = toBoardMetadata({ id: 'b1', title: 'Mesh', projectId: 'p1' });

    expect(metadata).toMatchObject({
      keyVersion: 1,
      publicShareToken: null,
      updatedAt: '',
      project: { id: '', name: '', organizationId: '', keyVersion: 1, encryptedProjectKey: null },
    });
    expect(metadata.project.members).toBeUndefined();
  });

  it('carries the project, its members and the public link through', () => {
    const metadata = toBoardMetadata({
      id: 'b1',
      title: 'Mesh',
      projectId: 'p1',
      keyVersion: 3,
      publicShareToken: 'tok',
      project: {
        id: 'p1',
        name: 'Core',
        organizationId: 'w1',
        keyVersion: 4,
        organization: { id: 'w1', name: 'Acme', slug: 'acme' },
        members: [{ userId: 'u1', role: 'editor', encryptedProjectKey: 'k' }, { userId: 'u2' }],
      },
    });

    expect(metadata.keyVersion).toBe(3);
    expect(metadata.publicShareToken).toBe('tok');
    expect(metadata.project.organization).toEqual({ id: 'w1', name: 'Acme', slug: 'acme' });
    expect(metadata.project.members).toEqual([
      { id: '', userId: 'u1', role: 'editor', encryptedProjectKey: 'k' },
      { id: '', userId: 'u2', role: undefined, encryptedProjectKey: null },
    ]);
  });
});
