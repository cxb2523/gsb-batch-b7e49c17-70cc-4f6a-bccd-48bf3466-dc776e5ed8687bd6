import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listWorkspaceMembers, getPublicInvitation } from './api';
import { ApiError } from '@/lib/http';

describe('members api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listWorkspaceMembers parses member list and user details', async () => {
    const mockMembers = [
      {
        id: 'm1',
        userId: 'u1',
        role: 'owner',
        user: { id: 'u1', name: 'Alice', email: 'alice@example.com' },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockMembers),
      }),
    );

    const result = await listWorkspaceMembers('w1');
    expect(result).toHaveLength(1);
    if (Array.isArray(result)) {
      expect(result[0]?.user?.email).toBe('alice@example.com');
    }
  });

  it('getPublicInvitation parses public invitation details', async () => {
    const mockInvite = {
      id: 'inv1',
      email: 'bob@example.com',
      role: 'editor',
      organizationId: 'w1',
      organizationName: 'Acme',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockInvite),
      }),
    );

    const result = await getPublicInvitation('inv1');
    expect(result.id).toBe('inv1');
    expect(result.organizationName).toBe('Acme');
  });

  it('throws UNEXPECTED_RESPONSE on schema mismatch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ notAnInvite: true }),
      }),
    );

    await expect(getPublicInvitation('inv1')).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.code).toBe('UNEXPECTED_RESPONSE');
      }
      return true;
    });
  });
});
