import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWorkspace, getWorkspaceRotationPlan, getAccessMe } from './api';
import { ApiError } from '@/lib/http';

describe('workspaces api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getWorkspace validates and returns workspace', async () => {
    const mockData = {
      id: 'w1',
      name: 'Engineering',
      slug: 'engineering',
      keyVersion: 1,
      _count: { members: 3, projects: 2, boards: 5 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockData),
      }),
    );

    const result = await getWorkspace('engineering');
    expect(result.id).toBe('w1');
    expect(result.slug).toBe('engineering');
  });

  it('throws UNEXPECTED_RESPONSE when response shape is invalid', async () => {
    // Missing required fields id, name, slug
    const badData = { foo: 'bar' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(badData),
      }),
    );

    await expect(getWorkspace('bad')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.code).toBe('UNEXPECTED_RESPONSE');
      }
      return true;
    });
  });

  it('maps HTTP errors cleanly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Workspace not found' }),
      }),
    );

    await expect(getWorkspace('nonexistent')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.status).toBe(404);
        expect(err.message).toBe('Workspace not found');
      }
      return true;
    });
  });

  it('getWorkspaceRotationPlan parses holders and projects', async () => {
    const plan = {
      keyVersion: 1,
      holders: [{ userId: 'u1', publicKey: 'spki_key' }],
      projects: [{ id: 'p1', keyVersion: 1, encryptedProjectKey: 'wrap_key' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(plan),
      }),
    );

    const result = await getWorkspaceRotationPlan('w1');
    expect(result.keyVersion).toBe(1);
    expect(result.holders).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
  });

  it('getAccessMe parses user ability rules', async () => {
    const access = {
      canCreateWorkspace: true,
      workspaceRole: 'owner',
      isWorkspaceAdministrator: true,
      rules: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(access),
      }),
    );

    const result = await getAccessMe('w1');
    expect(result.canCreateWorkspace).toBe(true);
    expect(result.workspaceRole).toBe('owner');
  });
});
