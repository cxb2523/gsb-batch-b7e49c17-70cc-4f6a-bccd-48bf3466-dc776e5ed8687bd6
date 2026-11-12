/**
 * The access matrix, as data.
 *
 * Every protected route in the application appears here with the status the rule table implies
 * for each caller. The matrix spec executes it; the route-inventory spec fails when a registered
 * route is missing from it.
 */

import { randomUUID } from 'node:crypto';
import {
  V1_BOARD_PAYLOAD,
  V1_FILE_BUFFER,
  V1_WRAPPED_KEY,
  wrappedKeyWithVersions,
} from './fixtures.js';

export type MatrixActorKey =
  | 'owner'
  | 'admin'
  | 'projectAdmin'
  | 'projectEditor'
  | 'projectViewer'
  | 'unassignedEditor'
  | 'unassignedViewer'
  | 'stranger'
  | 'anonymous';

export const MATRIX_ACTORS: MatrixActorKey[] = [
  'owner',
  'admin',
  'projectAdmin',
  'projectEditor',
  'projectViewer',
  'unassignedEditor',
  'unassignedViewer',
  'stranger',
  'anonymous',
];

export interface MatrixScenario {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  boardId: string;
  invitationId: string;
  /** The unassigned workspace editor's `Member` row. */
  targetMemberId: string;
  projectEditorUserId: string;
  unassignedViewerUserId: string;
  /** A user that has a public key, for the public-key lookup route. */
  publicKeyUserId: string;
  /** A member who holds the workspace key and can take ownership. */
  ownershipTargetId: string;
  workspaceAdminUserIds?: string[];
}

export interface MatrixRow {
  /** `METHOD /path`, matching what Nest registers. */
  key: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  /** Mutating rows get a fresh scenario per caller so one case cannot affect the next. */
  mutating: boolean;
  url: (scenario: MatrixScenario) => string;
  headers?: (scenario: MatrixScenario) => Record<string, string>;
  body?: (scenario: MatrixScenario) => Record<string, unknown> | Buffer;
  binary?: boolean;
  /** A live stream that never ends: only its status is read, then the connection is dropped. */
  stream?: boolean;
  /** Sign in a throwaway user for this case, so a destructive route affects nobody else. */
  freshActor?: boolean;
  /** Extra state a fresh actor needs before the request. */
  prepare?: 'encryption' | 'account';
  expected: Record<MatrixActorKey, number>;
}

function expected(
  overrides: Partial<Record<MatrixActorKey, number>>,
): Record<MatrixActorKey, number> {
  const base = Object.fromEntries(
    MATRIX_ACTORS.map((actor) => [actor, actor === 'anonymous' ? 401 : 403]),
  ) as Record<MatrixActorKey, number>;
  return { ...base, ...overrides };
}

const ALL_MEMBERS = expected({
  owner: 200,
  admin: 200,
  projectAdmin: 200,
  projectEditor: 200,
  projectViewer: 200,
  unassignedEditor: 200,
  unassignedViewer: 200,
});

const ADMINISTRATORS = expected({ owner: 200, admin: 200 });

const ASSIGNED = expected({
  owner: 200,
  admin: 200,
  projectAdmin: 200,
  projectEditor: 200,
  projectViewer: 200,
});

const BOARD_WRITERS = expected({
  owner: 200,
  admin: 200,
  projectAdmin: 200,
  projectEditor: 200,
});

const AUTHENTICATED_SESSION = expected({
  owner: 200,
  admin: 200,
  projectAdmin: 200,
  projectEditor: 200,
  projectViewer: 200,
  unassignedEditor: 200,
  unassignedViewer: 200,
  stranger: 200,
});

/** Any signed-in account, wherever it belongs, gets this status; only a signed-out caller is refused. */
function everySignedIn(status: number): Record<MatrixActorKey, number> {
  return expected({
    owner: status,
    admin: status,
    projectAdmin: status,
    projectEditor: status,
    projectViewer: status,
    unassignedEditor: status,
    unassignedViewer: status,
    stranger: status,
  });
}

function row(r: Omit<MatrixRow, 'key'>): MatrixRow {
  return { ...r, key: `${r.method.toUpperCase()} ${r.path}` };
}

export const MATRIX_ROWS: MatrixRow[] = [
  row({
    method: 'get',
    path: '/api/workspaces/:slugOrId',
    mutating: false,
    url: (s) => `/api/workspaces/${s.workspaceSlug}`,
    expected: ALL_MEMBERS,
  }),
  row({
    method: 'patch',
    path: '/api/workspaces/:id',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}`,
    body: () => ({ name: 'Renamed Workspace' }),
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'get',
    path: '/api/workspaces/:id/members',
    mutating: false,
    url: (s) => `/api/workspaces/${s.workspaceId}/members`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'post',
    path: '/api/workspaces/:id/members/invite',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}/members/invite`,
    body: () => ({ email: `invitee-${Date.now()}-${Math.random()}@local.com`, role: 'editor' }),
    expected: expected({ owner: 201, admin: 201 }),
  }),
  row({
    method: 'get',
    path: '/api/workspaces/:id/invitations',
    mutating: false,
    url: (s) => `/api/workspaces/${s.workspaceId}/invitations`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'delete',
    path: '/api/workspaces/:id/invitations/:invitationId',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}/invitations/${s.invitationId}`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'post',
    path: '/api/workspaces',
    mutating: true,
    url: () => '/api/workspaces',
    body: () => ({
      id: randomUUID(),
      name: `New Workspace ${Date.now()}`,
      encryptedOrgKey: V1_WRAPPED_KEY,
      project: {
        id: randomUUID(),
        name: 'New Project',
        encryptedProjectKey: V1_WRAPPED_KEY,
        creatorEncryptedProjectKey: V1_WRAPPED_KEY,
      },
    }),
    expected: expected({
      owner: 201,
      admin: 201,
      projectAdmin: 403,
      projectEditor: 403,
      projectViewer: 403,
      unassignedEditor: 403,
      unassignedViewer: 403,
      stranger: 201,
    }),
  }),
  row({
    method: 'patch',
    path: '/api/workspaces/:id/members/:memberId',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}/members/${s.targetMemberId}`,
    body: () => ({ role: 'viewer' }),
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'post',
    path: '/api/workspaces/:id/transfer-ownership',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}/transfer-ownership`,
    body: (s) => ({ memberId: s.ownershipTargetId }),
    expected: expected({ owner: 201 }),
  }),
  row({
    method: 'delete',
    path: '/api/workspaces/:id/members/:memberId',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}/members/${s.targetMemberId}`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'delete',
    path: '/api/workspaces/:id',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}`,
    expected: expected({ owner: 200 }),
  }),
  row({
    method: 'get',
    path: '/api/workspaces/:id/rotation-plan',
    mutating: false,
    url: (s) => `/api/workspaces/${s.workspaceId}/rotation-plan`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'get',
    path: '/api/workspaces/:id/rekey-queue',
    mutating: false,
    url: (s) => `/api/workspaces/${s.workspaceId}/rekey-queue`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'post',
    path: '/api/workspaces/:id/rotate-key',
    mutating: true,
    url: (s) => `/api/workspaces/${s.workspaceId}/rotate-key`,
    body: (s) => ({
      expectedVersion: 1,
      encryptedOrgKeys: (s.workspaceAdminUserIds ?? []).map((userId) => ({
        userId,
        encryptedOrgKey: wrappedKeyWithVersions([2]),
      })),
      projects: [
        {
          id: s.projectId,
          projectKeyVersion: 1,
          encryptedProjectKey: wrappedKeyWithVersions([1, 2]),
        },
      ],
    }),
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'post',
    path: '/api/projects',
    mutating: true,
    url: () => '/api/projects',
    body: () => ({
      id: randomUUID(),
      name: `Project ${Date.now()}`,
      encryptedProjectKey: V1_WRAPPED_KEY,
      creatorEncryptedProjectKey: V1_WRAPPED_KEY,
    }),
    expected: expected({ owner: 201, admin: 201 }),
  }),
  row({
    method: 'get',
    path: '/api/projects',
    mutating: false,
    url: () => '/api/projects',
    expected: ALL_MEMBERS,
  }),
  row({
    method: 'patch',
    path: '/api/projects/:id',
    mutating: true,
    url: (s) => `/api/projects/${s.projectId}`,
    body: () => ({ name: 'Renamed Project' }),
    expected: expected({ owner: 200, admin: 200, projectAdmin: 200 }),
  }),
  row({
    method: 'delete',
    path: '/api/projects/:id',
    mutating: true,
    url: (s) => `/api/projects/${s.projectId}`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'get',
    path: '/api/projects/:id/rotation-plan',
    mutating: false,
    url: (s) => `/api/projects/${s.projectId}/rotation-plan`,
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'post',
    path: '/api/projects/:id/rotate-key',
    mutating: true,
    url: (s) => `/api/projects/${s.projectId}/rotate-key`,
    body: () => ({
      expectedVersion: 1,
      encryptedProjectKey: wrappedKeyWithVersions([2, 1]),
      historyEntry: wrappedKeyWithVersions([1, 2]),
      grants: [],
    }),
    expected: ADMINISTRATORS,
  }),
  row({
    method: 'get',
    path: '/api/projects/:id/key-history',
    mutating: false,
    url: (s) => `/api/projects/${s.projectId}/key-history`,
    expected: ASSIGNED,
  }),
  row({
    method: 'get',
    path: '/api/projects/:id/members',
    mutating: false,
    url: (s) => `/api/projects/${s.projectId}/members`,
    expected: ASSIGNED,
  }),
  row({
    method: 'get',
    path: '/api/projects/:id/assignable-members',
    mutating: false,
    url: (s) => `/api/projects/${s.projectId}/assignable-members`,
    expected: expected({ owner: 200, admin: 200, projectAdmin: 200 }),
  }),
  row({
    method: 'post',
    path: '/api/projects/:id/members',
    mutating: true,
    url: (s) => `/api/projects/${s.projectId}/members`,
    body: (s) => ({
      userId: s.unassignedViewerUserId,
      role: 'viewer',
      encryptedProjectKey: V1_WRAPPED_KEY,
    }),
    expected: expected({ owner: 201, admin: 201, projectAdmin: 201 }),
  }),
  row({
    method: 'patch',
    path: '/api/projects/:id/members/:userId',
    mutating: true,
    url: (s) => `/api/projects/${s.projectId}/members/${s.projectEditorUserId}`,
    body: () => ({ role: 'viewer' }),
    expected: expected({ owner: 200, admin: 200, projectAdmin: 200 }),
  }),
  row({
    method: 'delete',
    path: '/api/projects/:id/members/:userId',
    mutating: true,
    url: (s) => `/api/projects/${s.projectId}/members/${s.projectEditorUserId}`,
    expected: expected({ owner: 200, admin: 200, projectAdmin: 200 }),
  }),
  row({
    method: 'get',
    path: '/api/boards',
    mutating: false,
    url: () => '/api/boards',
    expected: ALL_MEMBERS,
  }),
  row({
    method: 'post',
    path: '/api/boards',
    mutating: true,
    url: () => '/api/boards',
    body: (s) => ({
      id: randomUUID(),
      projectId: s.projectId,
      title: `Board ${Date.now()}`,
      encryptedBoardKey: V1_WRAPPED_KEY,
      projectKeyVersion: 1,
    }),
    expected: expected({ owner: 201, admin: 201, projectAdmin: 201, projectEditor: 201 }),
  }),
  row({
    method: 'get',
    path: '/api/boards/:id',
    mutating: false,
    url: (s) => `/api/boards/${s.boardId}`,
    expected: ASSIGNED,
  }),
  row({
    method: 'get',
    path: '/api/boards/:id/payload',
    mutating: false,
    url: (s) => `/api/boards/${s.boardId}/payload`,
    expected: ASSIGNED,
  }),
  row({
    method: 'put',
    path: '/api/boards/:id/payload',
    mutating: true,
    url: (s) => `/api/boards/${s.boardId}/payload`,
    headers: () => ({ 'x-board-revision': '0' }),
    body: () => V1_BOARD_PAYLOAD,
    binary: true,
    expected: BOARD_WRITERS,
  }),
  row({
    method: 'get',
    path: '/api/boards/:id/files/:fileId',
    mutating: false,
    url: (s) => `/api/boards/${s.boardId}/files/test-file-id`,
    expected: ASSIGNED,
  }),
  row({
    method: 'put',
    path: '/api/boards/:id/files/:fileId',
    mutating: true,
    url: (s) => `/api/boards/${s.boardId}/files/test-file-id`,
    body: () => V1_FILE_BUFFER,
    binary: true,
    expected: BOARD_WRITERS,
  }),
  row({
    method: 'patch',
    path: '/api/boards/:id',
    mutating: true,
    url: (s) => `/api/boards/${s.boardId}`,
    body: () => ({ title: 'Renamed Board' }),
    expected: BOARD_WRITERS,
  }),
  row({
    method: 'delete',
    path: '/api/boards/:id',
    mutating: true,
    url: (s) => `/api/boards/${s.boardId}`,
    expected: BOARD_WRITERS,
  }),
  row({
    method: 'post',
    path: '/api/boards/:id/public-share',
    mutating: true,
    url: (s) => `/api/boards/${s.boardId}/public-share`,
    expected: expected({ owner: 201, admin: 201, projectAdmin: 201, projectEditor: 201 }),
  }),
  row({
    method: 'delete',
    path: '/api/boards/:id/public-share',
    mutating: true,
    url: (s) => `/api/boards/${s.boardId}/public-share`,
    expected: BOARD_WRITERS,
  }),
  row({
    method: 'post',
    path: '/api/boards/:id/public-share/rotate',
    mutating: true,
    url: (s) => `/api/boards/${s.boardId}/public-share/rotate`,
    expected: expected({ owner: 201, admin: 201, projectAdmin: 201, projectEditor: 201 }),
  }),
  row({
    method: 'get',
    path: '/api/invitations/:id/recipient',
    mutating: false,
    url: (s) => `/api/invitations/${s.invitationId}/recipient`,
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'post',
    path: '/api/invitations/:id/accept',
    mutating: false,
    url: (s) => `/api/invitations/${s.invitationId}/accept`,
    body: () => ({}),
    expected: expected({
      owner: 403,
      admin: 403,
      projectAdmin: 403,
      projectEditor: 403,
      projectViewer: 403,
      unassignedEditor: 403,
      unassignedViewer: 403,
      stranger: 403,
    }),
  }),
  // The inbox is the caller's own whoever they are, so every signed-in account may use it.
  row({
    method: 'get',
    path: '/api/notifications',
    mutating: false,
    url: () => '/api/notifications',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/notifications/unread-count',
    mutating: false,
    url: () => '/api/notifications/unread-count',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/notifications/stream',
    mutating: false,
    stream: true,
    url: () => '/api/notifications/stream',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'post',
    path: '/api/notifications/read-all',
    mutating: true,
    url: () => '/api/notifications/read-all',
    expected: everySignedIn(201),
  }),
  row({
    method: 'post',
    path: '/api/notifications/:id/read',
    mutating: false,
    url: () => '/api/notifications/not-a-real-notification/read',
    expected: everySignedIn(404),
  }),
  row({
    method: 'get',
    path: '/api/access/me',
    mutating: false,
    url: () => '/api/access/me',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/user/encryption-params',
    mutating: false,
    url: () => '/api/user/encryption-params',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'post',
    path: '/api/user/encryption-setup',
    mutating: false,
    freshActor: true,
    url: () => '/api/user/encryption-setup',
    body: () => ({
      kdfSalt: 'salt',
      keyWrapIv: 'iv',
      wrappedPrivateKey: 'wrapped',
      publicKey: 'public',
    }),
    expected: expected({
      owner: 201,
      admin: 201,
      projectAdmin: 201,
      projectEditor: 201,
      projectViewer: 201,
      unassignedEditor: 201,
      unassignedViewer: 201,
      stranger: 201,
    }),
  }),
  row({
    method: 'put',
    path: '/api/user/encryption-passphrase',
    mutating: false,
    freshActor: true,
    prepare: 'encryption',
    url: () => '/api/user/encryption-passphrase',
    body: () => ({ kdfSalt: 'salt', keyWrapIv: 'iv', wrappedPrivateKey: 'wrapped' }),
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/user/public-key/:id',
    mutating: false,
    url: (s) => `/api/user/public-key/${s.publicKeyUserId}`,
    expected: expected({
      owner: 200,
      admin: 200,
      projectAdmin: 200,
      projectEditor: 200,
      projectViewer: 200,
      unassignedEditor: 200,
      unassignedViewer: 200,
      stranger: 404,
    }),
  }),
  row({
    method: 'patch',
    path: '/api/user/profile',
    mutating: false,
    url: () => '/api/user/profile',
    body: () => ({ name: 'Renamed Actor' }),
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/user/accounts',
    mutating: false,
    url: () => '/api/user/accounts',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'delete',
    path: '/api/user/accounts/:providerId',
    mutating: false,
    freshActor: true,
    prepare: 'account',
    url: () => '/api/user/accounts/github',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/user/owned-workspaces',
    mutating: false,
    url: () => '/api/user/owned-workspaces',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/user/metrics',
    mutating: false,
    url: () => '/api/user/metrics',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'get',
    path: '/api/user/export-data',
    mutating: false,
    url: () => '/api/user/export-data',
    expected: AUTHENTICATED_SESSION,
  }),
  row({
    method: 'post',
    path: '/api/user/delete-account',
    mutating: false,
    freshActor: true,
    url: () => '/api/user/delete-account',
    body: () => ({}),
    expected: AUTHENTICATED_SESSION,
  }),
];
