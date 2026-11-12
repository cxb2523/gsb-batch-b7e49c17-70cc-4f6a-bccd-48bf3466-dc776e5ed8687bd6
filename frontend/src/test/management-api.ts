import { vi } from 'vitest';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import { errorResponse, jsonResponse } from './http';

/** A fake backend for the workspace management screens: real `Response`s, routed by method and path. */

function packedRules(
  define: (can: (action: string | string[], subject: string | string[]) => void) => void,
) {
  const { can, build } = new AbilityBuilder<MongoAbility>(createMongoAbility);
  define(can);
  return packRules(build().rules);
}

const ownerRules = packedRules((can) => {
  can('read', 'Workspace');
  can('update', 'Workspace');
  can('delete', 'Workspace');
  can('transfer', 'Workspace');
  can(['create', 'read', 'delete'], 'Invitation');
  can(['read', 'create', 'update', 'delete'], 'Project');
  can(['read', 'update', 'delete'], 'Member');
  can('manage', 'ProjectMember');
  can(['read', 'create', 'update', 'delete', 'share'], 'Board');
});

const adminRules = packedRules((can) => {
  can('read', 'Workspace');
  can('update', 'Workspace');
  can(['create', 'read', 'delete'], 'Invitation');
  can(['read', 'create', 'update', 'delete'], 'Project');
  can(['read', 'update', 'delete'], 'Member');
  can('manage', 'ProjectMember');
  can(['read', 'create', 'update', 'delete', 'share'], 'Board');
});

const readOnlyRules = packedRules((can) => {
  can('read', 'Workspace');
});

const projectRules = {
  admin: adminRules,
  editor: packedRules((can) => {
    can('read', 'Project');
    can('read', 'ProjectMember');
    can(['read', 'create', 'update', 'delete', 'share'], 'Board');
  }),
  viewer: packedRules((can) => {
    can('read', 'Project');
    can('read', 'ProjectMember');
    can('read', 'Board');
  }),
};

export type ManagementRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** The body of `GET /api/access/me` for a caller with `role` in the fixture workspace. */
export function accessMe(role: ManagementRole) {
  const isOwner = role === 'owner';
  const isAdministrator = isOwner || role === 'admin';
  return {
    canCreateWorkspace: isAdministrator,
    workspace: { id: 'org-1', name: 'Acme Eng', slug: 'acme-eng' },
    workspaceRole: role,
    isWorkspaceAdministrator: isAdministrator,
    rules: isOwner ? ownerRules : isAdministrator ? adminRules : readOnlyRules,
    projectRules,
    projectRoles: { p1: isAdministrator ? 'admin' : role },
  };
}

export const fixtureWorkspace = {
  id: 'org-1',
  name: 'Acme Eng',
  slug: 'acme-eng',
  currentUserRole: 'owner',
  keyVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const fixtureProject = {
  id: 'p1',
  name: 'Core Architecture',
  organizationId: 'org-1',
  keyVersion: 1,
  encryptedProjectKey: 'wrapped-project-key',
  members: [{ id: 'pm-1', userId: 'u1', encryptedProjectKey: 'my-project-key' }],
  _count: { boards: 3, members: 1 },
};

export const fixtureMembers = [
  {
    id: 'mem-1',
    userId: 'u1',
    name: 'Lead Dev',
    email: 'lead@canvhq.internal',
    role: 'owner',
    assignedProjectsCount: 1,
  },
  {
    id: 'mem-2',
    userId: 'u2',
    name: 'Sam Engineer',
    email: 'sam@canvhq.internal',
    role: 'editor',
    assignedProjectsCount: 0,
  },
  {
    id: 'mem-3',
    userId: 'u3',
    name: 'Alex Admin',
    email: 'alex@canvhq.internal',
    role: 'admin',
    assignedProjectsCount: 1,
  },
];

/** What `GET /api/projects/:id/assignable-members` serves: workspace members with no grant yet. */
export const fixtureAssignable = [
  { userId: 'u2', name: 'Sam Engineer', email: 'sam@canvhq.internal' },
];

function onePage(total: number) {
  return { page: 1, limit: 100, total, totalPages: 1, hasNextPage: false, hasPrevPage: false };
}

export const fixtureInvitation = {
  id: 'inv_1',
  email: 'invited-dev@canvhq.internal',
  role: 'editor',
  status: 'pending',
  inviteUrl: 'https://canvhq.com/invite/inv_1',
};

export interface ApiRequest {
  url: string;
  method: string;
  body: unknown;
}

export interface ApiRoute {
  method: string;
  /** Matched against the request path (no origin, no query). */
  path: string | RegExp;
  respond: (request: ApiRequest) => Response | Promise<Response>;
}

function defaultRoutes(role: () => ManagementRole): ApiRoute[] {
  const ok = (body: unknown) => () => jsonResponse(body);
  return [
    { method: 'GET', path: '/api/access/me', respond: () => jsonResponse(accessMe(role())) },
    { method: 'GET', path: '/api/workspaces/acme-eng', respond: ok(fixtureWorkspace) },
    {
      method: 'PATCH',
      path: '/api/workspaces/org-1',
      respond: ({ body }) => {
        const name =
          typeof body === 'object' && body !== null && 'name' in body ? String(body.name) : '';
        return jsonResponse({
          id: 'org-1',
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        });
      },
    },
    { method: 'DELETE', path: '/api/workspaces/org-1', respond: ok({ success: true }) },
    { method: 'GET', path: '/api/projects', respond: ok([fixtureProject]) },
    {
      method: 'GET',
      path: '/api/projects/p1/members',
      respond: ok([
        {
          id: 'pm-1',
          userId: 'u1',
          name: 'Lead Dev',
          email: 'lead@canvhq.internal',
          role: 'admin',
        },
      ]),
    },
    {
      method: 'GET',
      path: '/api/projects/p1/assignable-members',
      respond: ok({ items: fixtureAssignable, pagination: onePage(fixtureAssignable.length) }),
    },
    {
      method: 'POST',
      path: '/api/projects/p1/members',
      respond: ok({ id: 'pm-2', role: 'editor' }),
    },
    { method: 'GET', path: '/api/workspaces/org-1/members', respond: ok(fixtureMembers) },
    {
      method: 'POST',
      path: '/api/workspaces/org-1/members/invite',
      respond: ({ body }) =>
        jsonResponse({
          id: 'inv_123',
          email: typeof body === 'object' && body !== null && 'email' in body ? body.email : '',
          role: 'editor',
          inviteUrl: 'https://canvhq.com/invite/inv_123',
        }),
    },
    {
      method: 'GET',
      path: '/api/workspaces/org-1/invitations',
      respond: ok([fixtureInvitation]),
    },
    {
      method: 'POST',
      path: '/api/workspaces/org-1/transfer-ownership',
      respond: ok({ success: true }),
    },
    { method: 'GET', path: '/api/boards', respond: ok([]) },
  ];
}

export interface ApiStub {
  fetchMock: ReturnType<typeof vi.fn>;
  /** Changes who the caller is for later `GET /api/access/me` requests. */
  setRole: (role: ManagementRole) => void;
  /** The requests made to `method path`, in order, with parsed JSON bodies. */
  requests: (method: string, path: string | RegExp) => ApiRequest[];
}

function matches(route: ApiRoute['path'], path: string): boolean {
  return typeof route === 'string' ? route === path : route.test(path);
}

/**
 * Replaces `fetch` with the fake backend. `overrides` win over the defaults, so a test can make a
 * single mutation fail with `errorResponse(...)`. Pair with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubManagementApi(
  overrides: ApiRoute[] = [],
  initialRole: ManagementRole = 'owner',
): ApiStub {
  let role = initialRole;
  const routes = [...overrides, ...defaultRoutes(() => role)];
  const seen: ApiRequest[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const request = { url, method, body };
    seen.push(request);

    const path = new URL(url, 'http://localhost').pathname;
    const route = routes.find((r) => r.method === method && matches(r.path, path));
    return route
      ? route.respond(request)
      : errorResponse(404, 'NOT_FOUND', `No stub for ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    setRole: (next) => {
      role = next;
    },
    requests: (method, path) =>
      seen.filter(
        (r) => r.method === method && matches(path, new URL(r.url, 'http://localhost').pathname),
      ),
  };
}
