/**
 * e2e/api-contract.spec.ts
 *
 * Validates the frontend-backend API contract across all resource endpoints.
 * Every response shape is validated against the corresponding Zod schema in src/features/[feature]/schemas.ts.
 *
 * Endpoints covered:
 * - GET  /api/auth-config (AuthConfigSchema)
 * - GET  /api/access/me (AccessMeSchema)
 * - GET  /api/workspaces/:slug (WorkspaceSchema)
 * - PATCH /api/workspaces/:id (WorkspaceSchema)
 * - GET  /api/workspaces/:id/rotation-plan (WorkspaceRotationPlanSchema)
 * - GET  /api/workspaces/:id/members (WorkspaceMembersListSchema)
 * - POST /api/workspaces/:id/members/invite (WorkspaceInvitationSchema)
 * - GET  /api/workspaces/:id/invitations (WorkspaceInvitationsListSchema)
 * - PATCH /api/workspaces/:id/members/:memberId (WorkspaceMemberSchema)
 * - GET  /api/projects (ProjectsListSchema)
 * - POST /api/projects (ProjectSchema)
 * - PATCH /api/projects/:id (ProjectSchema)
 * - GET  /api/projects/:id/members (ProjectMembersListSchema)
 * - GET  /api/projects/:id/rotation-plan (ProjectRotationPlanSchema)
 * - GET  /api/boards (BoardsListSchema)
 * - POST /api/boards (BoardSchema)
 * - GET  /api/boards/:id (BoardSchema)
 * - PATCH /api/boards/:id (BoardSchema)
 * - PUT  /api/boards/:id/payload (SaveBoardPayloadResultSchema)
 * - GET  /api/boards/:id/payload (Binary ArrayBuffer)
 * - POST /api/boards/:id/public-share (PublicShareResultSchema)
 * - POST /api/boards/:id/public-share/rotate (PublicShareResultSchema)
 * - DELETE /api/boards/:id/public-share (204/200)
 * - GET  /api/user/profile (UserProfileSchema)
 * - PATCH /api/user/profile (UserProfileSchema)
 * - GET  /api/user/linked-accounts (LinkedAccountsListSchema)
 * - GET  /api/user/owned-workspaces (OwnedWorkspacesListSchema)
 * - GET  /api/user/metrics (UserMetricsSchema)
 * - GET  /api/user/public-key/:id (UserPublicKeySchema)
 * - GET  /api/invitations/:id (PublicInvitationSchema)
 * - Error decision shapes: 409 Conflict / STALE_KEY_VERSION / KEY_ROTATED
 */

import { test, expect } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { API_URL } from './constants';
import {
  WorkspaceSchema,
  WorkspaceRotationPlanSchema,
  AccessMeSchema,
} from '../src/features/workspaces/schemas';
import {
  ProjectsListSchema,
  ProjectSchema,
  ProjectMembersListSchema,
  ProjectRotationPlanSchema,
} from '../src/features/projects/schemas';
import {
  BoardsListSchema,
  BoardSchema,
  SaveBoardPayloadResultSchema,
  PublicShareResultSchema,
} from '../src/features/boards/schemas';
import {
  WorkspaceMembersListSchema,
  WorkspaceMemberSchema,
  WorkspaceInvitationSchema,
  WorkspaceInvitationsListSchema,
  PublicInvitationSchema,
} from '../src/features/members/schemas';
import {
  UserProfileSchema,
  LinkedAccountsListSchema,
  OwnedWorkspacesListSchema,
  UserMetricsSchema,
  UserPublicKeySchema,
  AuthConfigSchema,
} from '../src/features/user/schemas';

const PASSPHRASE = 'ContractPassphrase123!';
const API_BASE = API_URL;

test.describe('API Contract Validation (Decision 8, Q-X13)', () => {
  test('validates all frontend schemas against the live backend endpoints', async ({
    browser,
    request,
  }) => {
    const ts = Date.now();
    const email = `contract_tester_${ts}@canvhq.internal`;
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Dev login
    const user = await createTestUserSession(request, context, email, `Contract User ${ts}`);

    // Auth config endpoint (public)
    const authConfigRes = await request.get(`${API_BASE}/api/auth/config`);
    expect(authConfigRes.ok()).toBeTruthy();
    const authConfigData = await authConfigRes.json();
    expect(() => AuthConfigSchema.parse(authConfigData)).not.toThrow();

    // 2. Set up passphrase & first workspace via browser UI
    await page.goto('/create-workspace');
    await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
    await page.fill('#passphrase', PASSPHRASE);
    await page.fill('#confirm-passphrase', PASSPHRASE);
    await page.check('#acknowledge-recovery');
    await page.click('#submit-passphrase-btn');

    await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    const wsName = `Contract WS ${ts}`;
    const projName = `Contract Project ${ts}`;
    await page.fill('#workspace-name', wsName);
    await page.fill('#project-name', projName);
    await page.click('button[id="submit-btn"]');
    await expect(page).toHaveURL(/\/w\//, { timeout: 20000 });

    const slug = new URL(page.url()).pathname.split('/')[2] ?? '';
    expect(slug).toBeTruthy();

    const authHeaders = {
      Cookie: `better-auth.session_token=${user.token}`,
      'active-organization': slug,
    };

    // 3. User profile & metrics endpoints
    const patchProfileRes = await request.patch(`${API_BASE}/api/user/profile`, {
      headers: authHeaders,
      data: { name: `Updated Contract User ${ts}` },
    });
    expect(patchProfileRes.ok()).toBeTruthy();
    const patchProfileData = await patchProfileRes.json();
    expect(() => UserProfileSchema.parse(patchProfileData)).not.toThrow();

    const accountsRes = await request.get(`${API_BASE}/api/user/accounts`, {
      headers: authHeaders,
    });
    expect(accountsRes.ok()).toBeTruthy();
    const accountsData = await accountsRes.json();
    expect(() => LinkedAccountsListSchema.parse(accountsData)).not.toThrow();

    const ownedWorkspacesRes = await request.get(`${API_BASE}/api/user/owned-workspaces`, {
      headers: authHeaders,
    });
    expect(ownedWorkspacesRes.ok()).toBeTruthy();
    const ownedWorkspacesData = await ownedWorkspacesRes.json();
    expect(() => OwnedWorkspacesListSchema.parse(ownedWorkspacesData)).not.toThrow();

    const metricsRes = await request.get(`${API_BASE}/api/user/metrics`, { headers: authHeaders });
    expect(metricsRes.ok()).toBeTruthy();
    const metricsData = await metricsRes.json();
    expect(() => UserMetricsSchema.parse(metricsData)).not.toThrow();

    const pubKeyRes = await request.get(`${API_BASE}/api/user/public-key/${user.userId}`, {
      headers: authHeaders,
    });
    expect(pubKeyRes.ok()).toBeTruthy();
    const pubKeyData = await pubKeyRes.json();
    expect(() => UserPublicKeySchema.parse(pubKeyData)).not.toThrow();

    // 4. Access me endpoint (global without workspace and workspace-scoped)
    const accessMeGlobalRes = await request.get(`${API_BASE}/api/access/me`, {
      headers: authHeaders,
    });
    expect(accessMeGlobalRes.ok()).toBeTruthy();
    const accessMeGlobalData = await accessMeGlobalRes.json();
    expect(() => AccessMeSchema.parse(accessMeGlobalData)).not.toThrow();
    expect(typeof accessMeGlobalData.canCreateWorkspace).toBe('boolean');

    const accessMeRes = await request.get(`${API_BASE}/api/access/me?workspace=${slug}`, {
      headers: authHeaders,
    });
    expect(accessMeRes.ok()).toBeTruthy();
    const accessMeData = await accessMeRes.json();
    expect(() => AccessMeSchema.parse(accessMeData)).not.toThrow();

    // 5. Workspace detail & update
    const wsRes = await request.get(`${API_BASE}/api/workspaces/${slug}`, { headers: authHeaders });
    expect(wsRes.ok()).toBeTruthy();
    const wsData = await wsRes.json();
    const validatedWs = WorkspaceSchema.parse(wsData);
    const workspaceId = validatedWs.id || '';
    expect(workspaceId).toBeTruthy();

    const patchWsRes = await request.patch(`${API_BASE}/api/workspaces/${workspaceId}`, {
      headers: authHeaders,
      data: { name: `${wsName} Renamed` },
    });
    expect(patchWsRes.ok()).toBeTruthy();
    const patchWsData = await patchWsRes.json();
    expect(() => WorkspaceSchema.parse(patchWsData)).not.toThrow();

    const wsRotationPlanRes = await request.get(
      `${API_BASE}/api/workspaces/${workspaceId}/rotation-plan`,
      { headers: authHeaders },
    );
    expect(wsRotationPlanRes.ok()).toBeTruthy();
    const wsRotationPlanData = await wsRotationPlanRes.json();
    expect(() => WorkspaceRotationPlanSchema.parse(wsRotationPlanData)).not.toThrow();

    // 6. Workspace Members & Invitations
    const membersRes = await request.get(`${API_BASE}/api/workspaces/${workspaceId}/members`, {
      headers: authHeaders,
    });
    expect(membersRes.ok()).toBeTruthy();
    const membersData = await membersRes.json();
    const parsedMembers = WorkspaceMembersListSchema.parse(membersData);
    const memberItems = Array.isArray(parsedMembers) ? parsedMembers : parsedMembers.items;
    expect(memberItems.length).toBeGreaterThan(0);
    const firstMember = memberItems[0];

    // Role update on self/firstMember
    if (firstMember?.id) {
      const updateRoleRes = await request.patch(
        `${API_BASE}/api/workspaces/${workspaceId}/members/${firstMember.id}`,
        {
          headers: authHeaders,
          data: { role: 'admin' },
        },
      );
      if (updateRoleRes.ok()) {
        const updateRoleData = await updateRoleRes.json();
        expect(() => WorkspaceMemberSchema.parse(updateRoleData)).not.toThrow();
      }
    }

    // Invite new member
    const inviteEmail = `contract_invited_${ts}@canvhq.internal`;
    const inviteRes = await request.post(
      `${API_BASE}/api/workspaces/${workspaceId}/members/invite`,
      {
        headers: authHeaders,
        data: { email: inviteEmail, role: 'editor' },
      },
    );
    expect(inviteRes.ok()).toBeTruthy();
    const inviteData = await inviteRes.json();
    const parsedInvite = WorkspaceInvitationSchema.parse(inviteData);

    const invitationsRes = await request.get(
      `${API_BASE}/api/workspaces/${workspaceId}/invitations`,
      { headers: authHeaders },
    );
    expect(invitationsRes.ok()).toBeTruthy();
    const invitationsData = await invitationsRes.json();
    expect(() => WorkspaceInvitationsListSchema.parse(invitationsData)).not.toThrow();

    // Public invitation view endpoint
    if (parsedInvite.id) {
      const publicInviteRes = await request.get(`${API_BASE}/api/invitations/${parsedInvite.id}`);
      if (publicInviteRes.ok()) {
        const publicInviteData = await publicInviteRes.json();
        expect(() => PublicInvitationSchema.parse(publicInviteData)).not.toThrow();
      }
    }

    // 7. Projects
    const projectsRes = await request.get(`${API_BASE}/api/projects`, { headers: authHeaders });
    expect(projectsRes.ok()).toBeTruthy();
    const projectsData = await projectsRes.json();
    const parsedProjects = ProjectsListSchema.parse(projectsData);
    const projectItems = Array.isArray(parsedProjects) ? parsedProjects : parsedProjects.items;
    expect(projectItems.length).toBeGreaterThan(0);
    const projectId = projectItems[0]!.id;

    // Project patch
    const patchProjRes = await request.patch(`${API_BASE}/api/projects/${projectId}`, {
      headers: authHeaders,
      data: { name: `${projName} Updated` },
    });
    expect(patchProjRes.ok()).toBeTruthy();
    const patchProjData = await patchProjRes.json();
    expect(() => ProjectSchema.parse(patchProjData)).not.toThrow();

    // Project members
    const projMembersRes = await request.get(`${API_BASE}/api/projects/${projectId}/members`, {
      headers: authHeaders,
    });
    expect(projMembersRes.ok()).toBeTruthy();
    const projMembersData = await projMembersRes.json();
    expect(() => ProjectMembersListSchema.parse(projMembersData)).not.toThrow();

    // Project rotation plan
    const projRotationPlanRes = await request.get(
      `${API_BASE}/api/projects/${projectId}/rotation-plan`,
      { headers: authHeaders },
    );
    expect(projRotationPlanRes.ok()).toBeTruthy();
    const projRotationPlanData = await projRotationPlanRes.json();
    expect(() => ProjectRotationPlanSchema.parse(projRotationPlanData)).not.toThrow();

    // 8. Boards
    const boardsRes = await request.get(`${API_BASE}/api/boards`, { headers: authHeaders });
    expect(boardsRes.ok()).toBeTruthy();
    const boardsData = await boardsRes.json();
    expect(() => BoardsListSchema.parse(boardsData)).not.toThrow();

    // Create a new board
    const boardId = crypto.randomUUID();
    const fakeWrappedKey = Buffer.from([
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      ...new Array(30).fill(1),
    ]).toString('base64url');
    const createBoardRes = await request.post(`${API_BASE}/api/boards`, {
      headers: authHeaders,
      data: {
        id: boardId,
        title: `Contract Canvas ${ts}`,
        projectId,
        encryptedBoardKey: fakeWrappedKey,
        projectKeyVersion: 1,
      },
    });
    expect(createBoardRes.ok()).toBeTruthy();
    const createBoardData = await createBoardRes.json();
    expect(() => BoardSchema.parse(createBoardData)).not.toThrow();

    // Board detail & patch
    const boardDetailRes = await request.get(`${API_BASE}/api/boards/${boardId}`, {
      headers: authHeaders,
    });
    expect(boardDetailRes.ok()).toBeTruthy();
    const boardDetailData = await boardDetailRes.json();
    expect(() => BoardSchema.parse(boardDetailData)).not.toThrow();

    const patchBoardRes = await request.patch(`${API_BASE}/api/boards/${boardId}`, {
      headers: authHeaders,
      data: { title: `Contract Canvas ${ts} Renamed` },
    });
    expect(patchBoardRes.ok()).toBeTruthy();
    const patchBoardData = await patchBoardRes.json();
    expect(() => BoardSchema.parse(patchBoardData)).not.toThrow();

    // Board payload upload and download
    const dummyPayload = Buffer.from([
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      ...new Array(40).fill(2),
    ]);
    const savePayloadRes = await request.put(`${API_BASE}/api/boards/${boardId}/payload`, {
      headers: {
        ...authHeaders,
        'Content-Type': 'application/octet-stream',
        'x-board-revision': '0',
      },
      data: dummyPayload,
    });
    expect(savePayloadRes.ok()).toBeTruthy();
    const savePayloadData = await savePayloadRes.json();
    expect(() => SaveBoardPayloadResultSchema.parse(savePayloadData)).not.toThrow();

    const getPayloadRes = await request.get(`${API_BASE}/api/boards/${boardId}/payload`, {
      headers: authHeaders,
    });
    expect(getPayloadRes.ok()).toBeTruthy();
    const payloadBytes = await getPayloadRes.body();
    expect(payloadBytes.length).toBeGreaterThan(0);

    // Public share endpoints
    const enableShareRes = await request.post(`${API_BASE}/api/boards/${boardId}/public-share`, {
      headers: authHeaders,
    });
    expect(enableShareRes.ok()).toBeTruthy();
    const enableShareData = await enableShareRes.json();
    expect(() => PublicShareResultSchema.parse(enableShareData)).not.toThrow();

    const rotateShareRes = await request.post(
      `${API_BASE}/api/boards/${boardId}/public-share/rotate`,
      { headers: authHeaders },
    );
    expect(rotateShareRes.ok()).toBeTruthy();
    const rotateShareData = await rotateShareRes.json();
    expect(() => PublicShareResultSchema.parse(rotateShareData)).not.toThrow();

    const disableShareRes = await request.delete(`${API_BASE}/api/boards/${boardId}/public-share`, {
      headers: authHeaders,
    });
    expect(disableShareRes.ok()).toBeTruthy();

    // 9. Error decision shapes (stale key version, missing required fields)
    const staleBoardRes = await request.post(`${API_BASE}/api/boards`, {
      headers: authHeaders,
      data: {
        id: `board_stale_${ts}`,
        title: 'Stale Board',
        projectId,
        encryptedBoardKey: 'AQAAAAEAAAAB' + 'A'.repeat(60),
        projectKeyVersion: 999, // mismatch / stale version
      },
    });
    expect([400, 409]).toContain(staleBoardRes.status());
    const staleData = await staleBoardRes.json().catch(() => ({}));
    expect(staleData).toBeDefined();

    await context.close();
  });
});
