import { describe, it, expect } from 'vitest';
import { exportPublicKey, generateSymmetricKey, generateUserIdentityKeypair } from '@/lib/crypto';
import {
  KeyVersionMismatchError,
  unwrapBoardKeyFromProject,
  unwrapProjectKeyForMember,
  unwrapProjectKeyFromWorkspace,
  unwrapWorkspaceKeyForMember,
} from '@/lib/crypto-format';
import {
  KeyServiceError,
  provisionBoardKeys,
  provisionProjectKeys,
  provisionWorkspaceKeys,
  resolveBoardKey,
  resolveOrgKey,
  resolveProjectKey,
  wrapKeyForMember,
  wrapWorkspaceKeyForMember,
} from './index';

/**
 * These use the real Web Crypto implementation: the service is the only place that does key
 * work, so its chain must round-trip, not just call mocks.
 */
async function identity() {
  const keypair = await generateUserIdentityKeypair();
  const publicKeySpki = await exportPublicKey(keypair.publicKey);
  return { privateKey: keypair.privateKey, publicKeySpki };
}

const workspaceId = '5b3c2f16-8f27-4d7e-9a67-3f27fdc5fd23';
const projectId = '0f9a2f4e-7f8b-4b4e-9a3c-c3f6f4f0a1b2';
const boardId = '5d0f9f8e-7c6b-4a3d-8e2f-1a0b9c8d7e6f';
const userId = '2a6c7e8f-3b4d-4c5e-9f01-23456789abcd';

async function expectKeyError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(KeyServiceError);
  if (error instanceof KeyServiceError) {
    expect(error.code).toBe(code);
  }
}

describe('key service', () => {
  it('provisions a workspace whose three wrapped keys all round-trip', async () => {
    const { privateKey, publicKeySpki } = await identity();

    const provisioned = await provisionWorkspaceKeys({
      workspaceId,
      projectId,
      userId,
      publicKeySpki,
      projectName: 'First Project',
    });

    const orgKey = await unwrapWorkspaceKeyForMember(provisioned.encryptedOrgKey, privateKey, {
      workspaceId,
      userId,
      workspaceKeyVersion: 1,
    });
    const projectFromWorkspace = await unwrapProjectKeyFromWorkspace(
      provisioned.project.encryptedProjectKey,
      orgKey,
      { workspaceId, projectId, projectKeyVersion: 1, workspaceKeyVersion: 1 },
    );
    const projectFromCreator = await unwrapProjectKeyForMember(
      provisioned.project.creatorEncryptedProjectKey,
      privateKey,
      { projectId, userId, projectKeyVersion: 1 },
    );

    // Both copies are the same project key: a board key wrapped with one opens with the other.
    const board = await provisionBoardKeys({
      projectKey: projectFromCreator,
      projectId,
      boardId,
      projectKeyVersion: 1,
    });
    await expect(
      unwrapBoardKeyFromProject(board.encryptedBoardKey, projectFromWorkspace, {
        projectId,
        boardId,
        boardKeyVersion: 1,
        projectKeyVersion: 1,
      }),
    ).resolves.toBeInstanceOf(CryptoKey);

    expect(provisioned.project.name).toBe('First Project');
    expect(provisioned.project.id).toBe(projectId);
    expect(provisioned.project.keyVersion).toBe(1);
  });

  it('provisions a project and a board and resolves them back through the workspace path', async () => {
    const { privateKey, publicKeySpki } = await identity();
    const orgKey = await generateSymmetricKey();
    const wrappedOrgForUser = await wrapWorkspaceKeyForMember(orgKey, publicKeySpki, {
      workspaceId,
      userId,
      workspaceKeyVersion: 1,
    });

    const project = await provisionProjectKeys({
      orgKey,
      workspaceId,
      workspaceKeyVersion: 1,
      projectId,
      userId,
      publicKeySpki,
      projectName: 'Project',
    });
    const resolvedProject = await resolveProjectKey({
      privateKey,
      projectId,
      projectKeyVersion: 1,
      userId,
      encryptedProjectKey: project.encryptedProjectKey,
      encryptedOrgKey: wrappedOrgForUser,
      workspaceId,
      workspaceKeyVersion: 1,
    });

    const board = await provisionBoardKeys({
      projectKey: resolvedProject,
      projectId,
      boardId,
      projectKeyVersion: 1,
    });
    await expect(
      resolveBoardKey(board.encryptedBoardKey, resolvedProject, {
        projectId,
        boardId,
        boardKeyVersion: 1,
        projectKeyVersion: 1,
      }),
    ).resolves.toBeInstanceOf(CryptoKey);

    const resolvedOrg = await resolveOrgKey(wrappedOrgForUser, privateKey, {
      workspaceId,
      userId,
      workspaceKeyVersion: 1,
    });
    expect(resolvedOrg).toBeInstanceOf(CryptoKey);
  });

  it('seals a canvas made after the project key rotated so that it opens again', async () => {
    // The server stores the project's version as the board's version, and that is what the
    // browser opens it with. A canvas made at version 3 must therefore be sealed as version 3.
    const projectKey = await generateSymmetricKey();
    const board = await provisionBoardKeys({
      projectKey,
      projectId,
      boardId,
      projectKeyVersion: 3,
    });

    await expect(
      resolveBoardKey(board.encryptedBoardKey, projectKey, {
        projectId,
        boardId,
        boardKeyVersion: 3,
        projectKeyVersion: 3,
      }),
    ).resolves.toBeInstanceOf(CryptoKey);
  });

  it('resolves a project through the member grant without the workspace key', async () => {
    const { privateKey, publicKeySpki } = await identity();
    const projectKey = await generateSymmetricKey();
    const memberGrant = await wrapKeyForMember(projectKey, publicKeySpki, {
      projectId,
      userId,
      projectKeyVersion: 1,
    });
    const workspaceKey = await generateSymmetricKey();
    const workspaceCopy = await provisionProjectKeys({
      orgKey: workspaceKey,
      workspaceId,
      workspaceKeyVersion: 1,
      projectId,
      userId,
      publicKeySpki,
      projectName: 'Project',
    });

    const resolved = await resolveProjectKey({
      privateKey,
      projectId,
      projectKeyVersion: 1,
      userId,
      encryptedProjectKey: workspaceCopy.encryptedProjectKey,
      memberEncryptedProjectKey: memberGrant,
    });

    const board = await provisionBoardKeys({
      projectKey: resolved,
      projectId,
      boardId,
      projectKeyVersion: 1,
    });
    await expect(
      resolveBoardKey(board.encryptedBoardKey, resolved, {
        projectId,
        boardId,
        boardKeyVersion: 1,
        projectKeyVersion: 1,
      }),
    ).resolves.toBeInstanceOf(CryptoKey);
  });

  it('throws a typed code instead of returning undefined', async () => {
    const { privateKey, publicKeySpki } = await identity();
    const orgKey = await generateSymmetricKey();

    await expectKeyError(
      provisionWorkspaceKeys({
        workspaceId,
        projectId,
        userId,
        publicKeySpki: null,
        projectName: 'P',
      }),
      'no-public-key',
    );
    await expectKeyError(
      provisionProjectKeys({
        orgKey: null,
        workspaceId,
        workspaceKeyVersion: 1,
        projectId,
        userId,
        publicKeySpki,
        projectName: 'P',
      }),
      'no-workspace-key',
    );
    await expectKeyError(
      provisionProjectKeys({
        orgKey,
        workspaceId,
        workspaceKeyVersion: 1,
        projectId,
        userId,
        publicKeySpki: null,
        projectName: 'P',
      }),
      'no-public-key',
    );
    await expectKeyError(
      provisionBoardKeys({
        projectKey: null,
        projectId,
        boardId,
        projectKeyVersion: 1,
      }),
      'no-project-key',
    );
    await expectKeyError(
      resolveOrgKey('wrapped', null, { workspaceId, userId, workspaceKeyVersion: 1 }),
      'locked',
    );
    await expectKeyError(
      resolveProjectKey({
        privateKey: null,
        projectId,
        projectKeyVersion: 1,
        userId,
        encryptedProjectKey: 'wrapped',
      }),
      'locked',
    );
    await expectKeyError(
      resolveProjectKey({
        privateKey,
        projectId,
        projectKeyVersion: 1,
        userId,
        encryptedProjectKey: undefined,
      }),
      'no-project-key',
    );
    await expectKeyError(
      resolveBoardKey(null, orgKey, {
        projectId,
        boardId,
        boardKeyVersion: 1,
        projectKeyVersion: 1,
      }),
      'no-project-key',
    );
    await expectKeyError(
      resolveBoardKey('wrapped', null, {
        projectId,
        boardId,
        boardKeyVersion: 1,
        projectKeyVersion: 1,
      }),
      'no-project-key',
    );

    const wrappedWithWrongKey = await wrapKeyForMember(orgKey, publicKeySpki, {
      projectId,
      userId,
      projectKeyVersion: 1,
    });
    await expectKeyError(
      resolveOrgKey(wrappedWithWrongKey, privateKey, {
        workspaceId: 'a8f5f167-6f5c-4a5b-9f2e-7d8c9b0a1e2f',
        userId,
        workspaceKeyVersion: 1,
      }),
      'unwrap-failed',
    );
  });

  it('detects a stale workspace key version when opening an older wrap', async () => {
    const { privateKey, publicKeySpki } = await identity();
    const orgKey = await generateSymmetricKey();
    const encryptedV1 = await wrapWorkspaceKeyForMember(orgKey, publicKeySpki, {
      workspaceId,
      userId,
      workspaceKeyVersion: 1,
    });

    // Caller expects version 2 (e.g. after a workspace rotation), but has v1 wrap
    const error = await resolveOrgKey(encryptedV1, privateKey, {
      workspaceId,
      userId,
      workspaceKeyVersion: 2,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(KeyServiceError);
    if (error instanceof KeyServiceError) {
      expect(error.code).toBe('unwrap-failed');
      expect(error.cause).toBeInstanceOf(KeyVersionMismatchError);
    }
  });
});
