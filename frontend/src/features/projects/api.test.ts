import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listProjects, createProject, updateProject } from './api';
import { ApiError } from '@/lib/http';

describe('projects api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listProjects returns parsed projects array', async () => {
    const mockProjects = [
      { id: 'p1', name: 'Alpha', organizationId: 'w1', keyVersion: 1 },
      { id: 'p2', name: 'Beta', organizationId: 'w1', keyVersion: 1 },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockProjects),
      }),
    );

    const result = await listProjects('w1');
    expect(result).toHaveLength(2);
    if (Array.isArray(result)) {
      expect(result[0]?.name).toBe('Alpha');
    }
  });

  it('createProject parses and returns new project', async () => {
    const newProj = { id: 'p3', name: 'Gamma', organizationId: 'w1', keyVersion: 1 };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(newProj),
      }),
    );

    const result = await createProject('w1', {
      id: 'p3',
      name: 'Gamma',
      encryptedProjectKey: 'blob1',
      creatorEncryptedProjectKey: 'blob2',
    });
    expect(result.id).toBe('p3');
  });

  it('throws UNEXPECTED_RESPONSE on schema failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ invalid: true }),
      }),
    );

    await expect(listProjects('w1')).rejects.toSatisfy((err) => {
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
        status: 403,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Forbidden' }),
      }),
    );

    await expect(updateProject('w1', 'p1', { name: 'New' })).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.status).toBe(403);
      }
      return true;
    });
  });
});
