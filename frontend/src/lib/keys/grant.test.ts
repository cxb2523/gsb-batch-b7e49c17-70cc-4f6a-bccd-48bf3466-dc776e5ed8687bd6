import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSymmetricKey } from '@/lib/crypto';
import { KeyServiceError } from './errors.js';
import { prepareProjectGrant } from './grant.js';

const service = vi.hoisted(() => ({
  fetchColleaguePublicKey: vi.fn<(userId: string) => Promise<string>>(),
  resolveProjectKey: vi.fn<(params: unknown) => Promise<CryptoKey>>(),
  wrapKeyForMember: vi.fn<(...args: unknown[]) => Promise<string>>(),
}));

vi.mock('./service.js', () => service);

const projectKey = await generateSymmetricKey();
const params = {
  privateKey: null,
  actorId: 'actor',
  targetUserId: 'target',
  project: {
    id: 'p1',
    keyVersion: 2,
    encryptedProjectKey: 'workspace-wrapped',
    members: [{ userId: 'actor', encryptedProjectKey: 'own-grant' }],
  },
  workspace: { id: 'w1', keyVersion: 3, encryptedOrgKey: 'org-key' },
};

describe('prepareProjectGrant', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    service.resolveProjectKey.mockResolvedValue(projectKey);
    service.fetchColleaguePublicKey.mockResolvedValue('target-public-key');
    service.wrapKeyForMember.mockResolvedValue('wrapped-for-target');
  });

  it('returns the key wrapped for the target under the project version', async () => {
    await expect(prepareProjectGrant(params)).resolves.toEqual({
      encryptedProjectKey: 'wrapped-for-target',
    });

    expect(service.resolveProjectKey).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        userId: 'actor',
        memberEncryptedProjectKey: 'own-grant',
        workspaceKeyVersion: 3,
      }),
    );
    expect(service.wrapKeyForMember).toHaveBeenCalledWith(projectKey, 'target-public-key', {
      projectId: 'p1',
      userId: 'target',
      projectKeyVersion: 2,
    });
  });

  it('refuses a project whose key version is unknown, before any key work', async () => {
    await expect(prepareProjectGrant({ ...params, project: { id: 'p1' } })).rejects.toThrow(
      'The project key version is unavailable',
    );
    expect(service.resolveProjectKey).not.toHaveBeenCalled();
  });

  it('wraps nothing when the target has no public key', async () => {
    service.fetchColleaguePublicKey.mockRejectedValue(
      new KeyServiceError('no-public-key', 'no key'),
    );

    await expect(prepareProjectGrant(params)).rejects.toMatchObject({ code: 'no-public-key' });
    expect(service.wrapKeyForMember).not.toHaveBeenCalled();
  });

  it('wraps nothing when the actor cannot open the project key', async () => {
    service.resolveProjectKey.mockRejectedValue(new KeyServiceError('locked', 'locked'));

    await expect(prepareProjectGrant(params)).rejects.toMatchObject({ code: 'locked' });
    expect(service.fetchColleaguePublicKey).not.toHaveBeenCalled();
  });
});
