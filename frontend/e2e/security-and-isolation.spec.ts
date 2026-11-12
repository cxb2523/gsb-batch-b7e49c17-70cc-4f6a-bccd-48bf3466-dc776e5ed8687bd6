import { test, expect } from '@playwright/test';
import { API_URL } from './constants';
import { createTestUserSession } from './e2ee-test-helpers';

const PASSPHRASE = 'SecurityIsolation123!';

interface Named {
  id: string;
  name: string;
}
interface BoardSummary {
  id: string;
  title: string;
}

function sessionHeaders(token: string, orgId?: string): Record<string, string> {
  const headers: Record<string, string> = { cookie: `better-auth.session_token=${token}` };
  if (orgId) headers['active-organization'] = orgId;
  return headers;
}

test.describe.serial('CanvHQ E2E Security & Tenant Isolation Suite', () => {
  const timestamp = Date.now();
  const user1Email = `sec_owner_${timestamp}@canvhq.internal`;
  const user2Email = `sec_attacker_${timestamp}@canvhq.internal`;
  const org1Name = `Security Org ${timestamp}`;

  let token1: string;
  let org1Id: string;
  let board1Id: string;
  let board1Title: string;

  test('1. Dev Login rejects non-development email domains (account takeover defense)', async ({
    request,
  }) => {
    const res = await request.post(`${API_URL}/api/auth/dev-login`, {
      data: { email: 'victim@corporate.com', name: 'Victim' },
    });
    expect(res.status()).toBe(403);
    const json = await res.json();
    expect(json.message).toContain('Dev login is restricted to local development test domains');
  });

  test('2. Cross-Tenant IDOR and Multi-Tenant Isolation Enforcement', async ({ page, request }) => {
    // Tenant 1 sets a passphrase, creates a workspace and a canvas through the real flow.
    const owner = await createTestUserSession(
      request,
      page.context(),
      user1Email,
      'Tenant 1 Owner',
    );
    token1 = owner.token;

    await page.goto('/create-workspace');
    await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
    await page.fill('#passphrase', PASSPHRASE);
    await page.fill('#confirm-passphrase', PASSPHRASE);
    await page.check('#acknowledge-recovery');
    await page.click('#submit-passphrase-btn');
    await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });

    await page.fill('#workspace-name', org1Name);
    await page.fill('#project-name', `Secret Project ${timestamp}`);
    await page.click('button[id="submit-btn"]');
    await expect(page).toHaveURL(/\/w\//, { timeout: 20000 });

    await page.locator('button:has-text("New Canvas")').first().click();
    await expect(page).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });

    const orgsRes = await request.get(`${API_URL}/api/auth/organization/list`, {
      headers: sessionHeaders(token1),
    });
    const orgs: Named[] = await orgsRes.json();
    const org1 = orgs.find((o) => o.name === org1Name);
    expect(org1).toBeTruthy();
    org1Id = org1?.id ?? '';

    const boardsRes = await request.get(`${API_URL}/api/boards`, {
      headers: sessionHeaders(token1, org1Id),
    });
    expect(boardsRes.ok()).toBeTruthy();
    const boardsBody: BoardSummary[] | { items: BoardSummary[] } = await boardsRes.json();
    const boards = Array.isArray(boardsBody) ? boardsBody : boardsBody.items;
    const [board1] = boards;
    if (!board1) {
      throw new Error('the owner has no canvas');
    }
    board1Id = board1.id;
    board1Title = board1.title;

    // Tenant 2 (attacker) signs in and attacks Tenant 1 with a forged active-organization header.
    const attacker = await createTestUserSession(request, page.context(), user2Email, 'Attacker');
    const attackerHeaders = sessionHeaders(attacker.token, org1Id);

    const idorReadRes = await request.get(`${API_URL}/api/boards/${board1Id}`, {
      headers: attackerHeaders,
    });
    expect(idorReadRes.status()).toBe(403);
    const idorReadJson = await idorReadRes.json();
    expect(idorReadJson.message).toContain('You are not a member of this workspace');

    const listRes = await request.get(`${API_URL}/api/boards`, { headers: attackerHeaders });
    expect(listRes.status()).toBe(403);
    const listJson = await listRes.json();
    expect(listJson.message).toContain('You are not a member of this workspace');

    const overwriteRes = await request.put(`${API_URL}/api/boards/${board1Id}/payload`, {
      headers: { ...attackerHeaders, 'content-type': 'application/octet-stream' },
      data: Buffer.from('malicious-payload'),
    });
    expect(overwriteRes.status()).toBe(403);
  });

  test('3. Invitation Recipient Email Binding prevents unauthorized workspace claim', async ({
    request,
  }) => {
    const targetEmail = `legit_invited_${timestamp}@canvhq.internal`;
    const inviteRes = await request.post(`${API_URL}/api/workspaces/${org1Id}/members/invite`, {
      headers: sessionHeaders(token1),
      data: { email: targetEmail, role: 'editor' },
    });
    expect(inviteRes.ok()).toBeTruthy();
    const inviteData = await inviteRes.json();
    const inviteId = inviteData.id;

    // User 2 (attacker) tries to accept the invite while logged in
    const resUser2 = await request.post(`${API_URL}/api/auth/dev-login`, {
      data: { email: user2Email, name: 'Attacker' },
    });
    const jsonUser2 = await resUser2.json();
    const token2 = jsonUser2.session?.signedToken || jsonUser2.session?.token;

    const acceptAttackerRes = await request.post(`${API_URL}/api/invitations/${inviteId}/accept`, {
      headers: sessionHeaders(token2),
    });
    expect(acceptAttackerRes.status()).toBe(403);
    const attackerJson = await acceptAttackerRes.json();
    expect(attackerJson.message).toContain('This invitation was sent to a different email address');

    // Legit user accepts it
    const resLegit = await request.post(`${API_URL}/api/auth/dev-login`, {
      data: { email: targetEmail, name: 'Legit User' },
    });
    const jsonLegit = await resLegit.json();
    const tokenLegit = jsonLegit.session?.signedToken || jsonLegit.session?.token;

    const acceptLegitRes = await request.post(`${API_URL}/api/invitations/${inviteId}/accept`, {
      headers: sessionHeaders(tokenLegit),
    });
    expect(acceptLegitRes.ok()).toBeTruthy();
    const legitJson = await acceptLegitRes.json();
    expect(legitJson.success).toBe(true);
  });

  test('4. Board Payload Stream Limit blocks unbounded memory exhaustion (> 15MB)', async ({
    request,
  }) => {
    // Send 16MB payload
    const oversizedBuffer = Buffer.alloc(16 * 1024 * 1024);
    let payloadRes;
    try {
      payloadRes = await request.put(`${API_URL}/api/boards/${board1Id}/payload`, {
        headers: {
          ...sessionHeaders(token1, org1Id),
          'content-type': 'application/octet-stream',
        },
        data: oversizedBuffer,
      });
    } catch (err) {
      // Immediate socket destruction (req.destroy) terminates connection to protect memory against DoS
      expect(String(err)).toMatch(/ECONNRESET|socket hang up/i);
      return;
    }

    expect(payloadRes.status()).toBe(413); // 413 Payload Too Large
    const errJson = await payloadRes.json();
    expect(errJson.message).toContain('payload exceeds maximum allowable size (15MB)');
  });

  test('5. Public Share isolation: Unauthenticated callers cannot read private boards directly, but can read via public share token when enabled', async ({
    request,
  }) => {
    // 1. Direct unauthenticated request to private board must return 401
    const directUnauthRes = await request.get(`${API_URL}/api/boards/${board1Id}`);
    expect(directUnauthRes.status()).toBe(401);

    // 2. Enable public share using owner credentials
    const enableShareRes = await request.post(`${API_URL}/api/boards/${board1Id}/public-share`, {
      headers: sessionHeaders(token1, org1Id),
    });
    expect(enableShareRes.ok()).toBeTruthy();
    const shareData = await enableShareRes.json();
    expect(shareData.isPublic).toBe(true);
    expect(shareData.publicShareToken).toBeDefined();

    // 3. Unauthenticated request to public endpoint succeeds
    const publicBoardRes = await request.get(
      `${API_URL}/api/public/boards/${shareData.publicShareToken}`,
    );
    expect(publicBoardRes.ok()).toBeTruthy();
    const publicData = await publicBoardRes.json();
    expect(publicData.title).toBe(board1Title);
    expect(publicData.isPublic).toBe(true);
    // Ensure zero leakage of internal ids
    expect(publicData.projectId).toBeUndefined();
    expect(publicData.organizationId).toBeUndefined();

    // 4. Disable public share
    const disableShareRes = await request.delete(`${API_URL}/api/boards/${board1Id}/public-share`, {
      headers: sessionHeaders(token1, org1Id),
    });
    expect(disableShareRes.ok()).toBeTruthy();

    // 5. Subsequent unauthenticated request to the token now returns 404 (revoked)
    const revokedRes = await request.get(
      `${API_URL}/api/public/boards/${shareData.publicShareToken}`,
    );
    expect(revokedRes.status()).toBe(404);
  });
});
