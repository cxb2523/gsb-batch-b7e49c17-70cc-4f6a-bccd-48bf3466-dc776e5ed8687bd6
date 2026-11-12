import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateSymmetricKey, generateUserIdentityKeypair, exportPublicKey } from '@/lib/crypto';
import { emptyResponse, errorResponse, jsonResponse } from '@/test/http';
import {
  DecryptionError,
  KeyVersionMismatchError,
  openBoardPayload,
  unwrapProjectKeyForMember,
  unwrapProjectKeyFromWorkspace,
  unwrapProjectKeyHistory,
  unwrapWorkspaceKeyForMember,
  wrapBoardKeyForProject,
  wrapProjectKeyForWorkspace,
  wrapWorkspaceKeyForMember,
  sealBoardPayload,
} from '@/lib/crypto-format';
import { KeyServiceError, rotateProjectKey, rotateDueProjects, rotateWorkspaceKey } from './index';

/**
 * Rotation with real Web Crypto and a mocked HTTP boundary: the keys the browser sends are
 * actually unwrapable, the removed person's old key really cannot open a re-sealed payload, and
 * a missing public key stops before any request.
 */

const workspaceId = 'workspace-1';
const projectId = 'project-1';
const boardId = 'board-1';
const userId = 'actor-1';

async function identity() {
  const keypair = await generateUserIdentityKeypair();
  return {
    privateKey: keypair.privateKey,
    publicKeySpki: await exportPublicKey(keypair.publicKey),
  };
}

async function encryptedOrgKeyFor(publicKeySpki: string) {
  const orgKey = await generateSymmetricKey();
  return {
    orgKey,
    encryptedOrgKey: await wrapWorkspaceKeyForMember(orgKey, await importSpki(publicKeySpki), {
      workspaceId,
      userId,
      workspaceKeyVersion: 1,
    }),
  };
}

async function importSpki(spki: string): Promise<CryptoKey> {
  const { importPublicKey } = await import('@/lib/crypto');
  return importPublicKey(spki);
}

function toUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input === 'object' && input !== null && 'url' in input) {
    const candidate = Reflect.get(input, 'url');
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project key rotation', () => {
  it('sends copies every remaining person can open, the removed person cannot, and keeps the old key in history', async () => {
    const actor = await identity();
    const remaining = await identity();

    const { orgKey, encryptedOrgKey } = await encryptedOrgKeyFor(actor.publicKeySpki);
    const oldProjectKey = await generateSymmetricKey();
    const project = {
      id: projectId,
      keyVersion: 1,
      keyRotationDue: true,
      encryptedProjectKey: await wrapProjectKeyForWorkspace(oldProjectKey, orgKey, {
        workspaceId,
        projectId,
        projectKeyVersion: 1,
        workspaceKeyVersion: 1,
      }),
    };
    const workspace = { id: workspaceId, keyVersion: 1, encryptedOrgKey };

    const captured: {
      body: {
        encryptedProjectKey: string;
        historyEntry: string;
        grants: Array<{ userId: string; encryptedProjectKey: string }>;
      } | null;
    } = { body: null };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = toUrl(input);
        if (url.includes('/rotation-plan')) {
          return jsonResponse({
            keyVersion: 1,
            keyRotationDue: true,
            grants: [
              { userId, publicKey: actor.publicKeySpki },
              { userId: 'remaining-1', publicKey: remaining.publicKeySpki },
            ],
          });
        }
        if (url.includes('/rotate-key')) {
          captured.body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          return jsonResponse({ keyVersion: 2 });
        }
        return emptyResponse(404);
      }),
    );

    const result = await rotateProjectKey({
      project,
      workspace,
      privateKey: actor.privateKey,
      userId,
    });
    expect(result).toEqual({ keyVersion: 2 });
    const submitted = captured.body;
    expect(submitted).not.toBeNull();
    if (!submitted) return;

    // Workspace copy opens the new key, and both person copies open the same key.
    const openedOrg = await unwrapWorkspaceKeyForMember(encryptedOrgKey, actor.privateKey, {
      workspaceId,
      userId,
      workspaceKeyVersion: 1,
    });
    const newFromWorkspace = await unwrapProjectKeyFromWorkspace(
      submitted.encryptedProjectKey,
      openedOrg,
      { workspaceId, projectId, projectKeyVersion: 2, workspaceKeyVersion: 1 },
    );
    const newForRemaining = await unwrapProjectKeyForMember(
      submitted.grants.find((grant) => grant.userId === 'remaining-1')!.encryptedProjectKey,
      remaining.privateKey,
      { projectId, userId: 'remaining-1', projectKeyVersion: 2 },
    );

    const sealed = await sealBoardPayload(
      newForRemaining,
      { elements: [{ id: 'post-rotation' }] },
      { boardId, keyVersion: 2, revision: 1 },
    );
    await expect(
      openBoardPayload(newFromWorkspace, sealed, { boardId, keyVersion: 2, revision: 1 }),
    ).resolves.toEqual({ elements: [{ id: 'post-rotation' }] });

    // The removed person only has the old key; it cannot open the new payload.
    await expect(
      openBoardPayload(oldProjectKey, sealed, { boardId, keyVersion: 2, revision: 1 }),
    ).rejects.toBeInstanceOf(DecryptionError);

    // The history entry recovers the old key from the new one.
    const historyOld = await unwrapProjectKeyHistory(submitted.historyEntry, newFromWorkspace, {
      projectId,
      oldVersion: 1,
      newVersion: 2,
    });
    const boardUnderOld = await wrapBoardKeyForProject(await generateSymmetricKey(), historyOld, {
      projectId,
      boardId,
      boardKeyVersion: 1,
      projectKeyVersion: 1,
    });
    expect(typeof boardUnderOld).toBe('string');
  });

  it('aborts before any request when a granted person has no public key', async () => {
    const actor = await identity();
    const { orgKey, encryptedOrgKey } = await encryptedOrgKeyFor(actor.publicKeySpki);
    const project = {
      id: projectId,
      keyVersion: 1,
      encryptedProjectKey: await wrapProjectKeyForWorkspace(await generateSymmetricKey(), orgKey, {
        workspaceId,
        projectId,
        projectKeyVersion: 1,
        workspaceKeyVersion: 1,
      }),
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        keyVersion: 1,
        keyRotationDue: true,
        grants: [{ userId: 'no-key', publicKey: null }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      rotateProjectKey({
        project,
        workspace: { id: workspaceId, keyVersion: 1, encryptedOrgKey },
        privateKey: actor.privateKey,
        userId,
      }),
    ).rejects.toBeInstanceOf(KeyServiceError);

    expect(fetchMock.mock.calls.some(([input]) => toUrl(input).includes('/rotate-key'))).toBe(
      false,
    );
  });

  it('treats a stale project as already rotated and stops on a real failure', async () => {
    const actor = await identity();
    const { orgKey, encryptedOrgKey } = await encryptedOrgKeyFor(actor.publicKeySpki);
    const workspace = { id: workspaceId, keyVersion: 1, encryptedOrgKey };
    const wrappedFor = async (id: string) =>
      wrapProjectKeyForWorkspace(await generateSymmetricKey(), orgKey, {
        workspaceId,
        projectId: id,
        projectKeyVersion: 1,
        workspaceKeyVersion: 1,
      });
    const projects = [
      {
        id: 'stale',
        keyVersion: 1,
        keyRotationDue: true,
        encryptedProjectKey: await wrappedFor('stale'),
      },
      {
        id: 'failing',
        keyVersion: 1,
        keyRotationDue: true,
        encryptedProjectKey: await wrappedFor('failing'),
      },
    ];

    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = toUrl(input);
        if (url.includes('/rotation-plan')) {
          call += 1;
          return jsonResponse({ keyVersion: 1, keyRotationDue: true, grants: [] });
        }
        if (url.includes('/stale/rotate-key')) {
          return jsonResponse({ code: 'STALE_KEY_VERSION' }, { status: 409 });
        }
        if (url.includes('/failing/rotate-key')) {
          return errorResponse(400, 'BAD_REQUEST', 'refused');
        }
        return emptyResponse(404);
      }),
    );

    const result = await rotateDueProjects({
      projects,
      workspace,
      privateKey: actor.privateKey,
      userId,
    });

    expect(result.rotated).toEqual(['stale']);
    expect(result.failed).toContain('refused');
    expect(call).toBe(2);
  });
});

describe('workspace key rotation', () => {
  it('rewraps projects and grants remaining admins new keys; demoted admin cannot unwrap new project wraps', async () => {
    const actor = await identity();
    const remainingAdmin = await identity();
    const demotedAdmin = await identity();

    const oldOrgKey = await generateSymmetricKey();
    const actorEncryptedOrgKey = await wrapWorkspaceKeyForMember(
      oldOrgKey,
      await importSpki(actor.publicKeySpki),
      { workspaceId, userId: actor.publicKeySpki, workspaceKeyVersion: 1 },
    );
    const demotedEncryptedOrgKey = await wrapWorkspaceKeyForMember(
      oldOrgKey,
      await importSpki(demotedAdmin.publicKeySpki),
      { workspaceId, userId: 'demoted-admin', workspaceKeyVersion: 1 },
    );

    const project1Key = await generateSymmetricKey();
    const project2Key = await generateSymmetricKey();

    const project1Encrypted = await wrapProjectKeyForWorkspace(project1Key, oldOrgKey, {
      workspaceId,
      projectId: 'project-1',
      projectKeyVersion: 1,
      workspaceKeyVersion: 1,
    });
    const project2Encrypted = await wrapProjectKeyForWorkspace(project2Key, oldOrgKey, {
      workspaceId,
      projectId: 'project-2',
      projectKeyVersion: 3,
      workspaceKeyVersion: 1,
    });

    // Positive control: demoted admin's old key can open pre-rotation projects
    const demotedOldOrg = await unwrapWorkspaceKeyForMember(
      demotedEncryptedOrgKey,
      demotedAdmin.privateKey,
      { workspaceId, userId: 'demoted-admin', workspaceKeyVersion: 1 },
    );
    const p1OpenedByDemoted = await unwrapProjectKeyFromWorkspace(
      project1Encrypted,
      demotedOldOrg,
      { workspaceId, projectId: 'project-1', projectKeyVersion: 1, workspaceKeyVersion: 1 },
    );
    expect(p1OpenedByDemoted).toBeDefined();

    const captured: {
      body: {
        expectedVersion: number;
        encryptedOrgKeys: Array<{ userId: string; encryptedOrgKey: string }>;
        projects: Array<{ id: string; projectKeyVersion: number; encryptedProjectKey: string }>;
      } | null;
    } = { body: null };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = toUrl(input);
        if (url.includes('/rotation-plan')) {
          return jsonResponse({
            keyVersion: 1,
            holders: [
              { userId: actor.publicKeySpki, publicKey: actor.publicKeySpki },
              { userId: 'remaining-admin', publicKey: remainingAdmin.publicKeySpki },
            ],
            projects: [
              { id: 'project-1', keyVersion: 1, encryptedProjectKey: project1Encrypted },
              { id: 'project-2', keyVersion: 3, encryptedProjectKey: project2Encrypted },
            ],
          });
        }
        if (url.includes('/rotate-key')) {
          captured.body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          return jsonResponse({ keyVersion: 2 });
        }
        return emptyResponse(404);
      }),
    );

    const result = await rotateWorkspaceKey({
      workspace: { id: workspaceId, keyVersion: 1, encryptedOrgKey: actorEncryptedOrgKey },
      privateKey: actor.privateKey,
      userId: actor.publicKeySpki,
    });

    expect(result.keyVersion).toBe(2);
    expect(result.newEncryptedOrgKey).toBeDefined();
    expect(captured.body).not.toBeNull();
    const submitted = captured.body!;
    expect(submitted.expectedVersion).toBe(1);
    expect(submitted.encryptedOrgKeys).toHaveLength(2);
    expect(submitted.projects).toHaveLength(2);

    // Remaining admin opens new workspace key with new wrap
    const remainingWrap = submitted.encryptedOrgKeys.find(
      (h) => h.userId === 'remaining-admin',
    )!.encryptedOrgKey;
    const newOrgKeyForRemaining = await unwrapWorkspaceKeyForMember(
      remainingWrap,
      remainingAdmin.privateKey,
      { workspaceId, userId: 'remaining-admin', workspaceKeyVersion: 2 },
    );

    // Remaining admin opens both rewrapped projects under new workspace key
    const p1Rewrapped = submitted.projects.find((p) => p.id === 'project-1')!;
    const p2Rewrapped = submitted.projects.find((p) => p.id === 'project-2')!;

    const p1OpenedNew = await unwrapProjectKeyFromWorkspace(
      p1Rewrapped.encryptedProjectKey,
      newOrgKeyForRemaining,
      { workspaceId, projectId: 'project-1', projectKeyVersion: 1, workspaceKeyVersion: 2 },
    );
    expect(p1OpenedNew).toBeDefined();

    const p2OpenedNew = await unwrapProjectKeyFromWorkspace(
      p2Rewrapped.encryptedProjectKey,
      newOrgKeyForRemaining,
      { workspaceId, projectId: 'project-2', projectKeyVersion: 3, workspaceKeyVersion: 2 },
    );
    expect(p2OpenedNew).toBeDefined();

    // The demoted admin's OLD workspace key cannot unwrap the rewrapped project key
    // When claiming version 2 with old key:
    await expect(
      unwrapProjectKeyFromWorkspace(p1Rewrapped.encryptedProjectKey, demotedOldOrg, {
        workspaceId,
        projectId: 'project-1',
        projectKeyVersion: 1,
        workspaceKeyVersion: 2,
      }),
    ).rejects.toThrow();

    // When claiming version 1 with old key: header mismatch
    await expect(
      unwrapProjectKeyFromWorkspace(p1Rewrapped.encryptedProjectKey, demotedOldOrg, {
        workspaceId,
        projectId: 'project-1',
        projectKeyVersion: 1,
        workspaceKeyVersion: 1,
      }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
  });

  it('aborts rotation before sending rotate-key if an admin has no public key', async () => {
    const actor = await identity();
    const oldOrgKey = await generateSymmetricKey();
    const actorEncryptedOrgKey = await wrapWorkspaceKeyForMember(
      oldOrgKey,
      await importSpki(actor.publicKeySpki),
      { workspaceId, userId: actor.publicKeySpki, workspaceKeyVersion: 1 },
    );

    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        keyVersion: 1,
        holders: [
          { userId: actor.publicKeySpki, publicKey: actor.publicKeySpki },
          { userId: 'admin-no-key', publicKey: null },
        ],
        projects: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await rotateWorkspaceKey({
      workspace: { id: workspaceId, keyVersion: 1, encryptedOrgKey: actorEncryptedOrgKey },
      privateKey: actor.privateKey,
      userId: actor.publicKeySpki,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(KeyServiceError);
    expect(err.code).toBe('no-public-key');
    expect(fetchMock.mock.calls.some(([input]) => toUrl(input).includes('/rotate-key'))).toBe(
      false,
    );
  });

  it('throws rotation-stale if the workspace version changed', async () => {
    const actor = await identity();
    const oldOrgKey = await generateSymmetricKey();
    const actorEncryptedOrgKey = await wrapWorkspaceKeyForMember(
      oldOrgKey,
      await importSpki(actor.publicKeySpki),
      { workspaceId, userId: actor.publicKeySpki, workspaceKeyVersion: 1 },
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL) =>
        jsonResponse({
          keyVersion: 2, // plan has version 2, caller expected version 1
          holders: [],
          projects: [],
        }),
      ),
    );

    const err = await rotateWorkspaceKey({
      workspace: { id: workspaceId, keyVersion: 1, encryptedOrgKey: actorEncryptedOrgKey },
      privateKey: actor.privateKey,
      userId: actor.publicKeySpki,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(KeyServiceError);
    expect(err.code).toBe('rotation-stale');
  });
});
