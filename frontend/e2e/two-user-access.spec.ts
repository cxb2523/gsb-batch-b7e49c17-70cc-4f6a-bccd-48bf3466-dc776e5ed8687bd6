import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { API_URL } from './constants';
import { sceneElementCount } from './scene-helpers';

const PASSPHRASE = 'TwoUsersPassphrase123!';
const API = API_URL;

async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

async function drawRectangle(page: Page): Promise<void> {
  const canvas = page.locator('canvas.excalidraw__canvas.interactive').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Excalidraw canvas has no bounding box');
  }

  const startX = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.6;

  await page.locator('button[aria-label="Rectangle"]').click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY + 110, { steps: 20 });
  await page.mouse.up();

  await expect.poll(() => sceneElementCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function signOutContext(context: BrowserContext): Promise<void> {
  await context.close();
}

test.describe('CanvHQ E2E: two real users, one pending grant', () => {
  test('a colleague joins, waits for access, is granted, and opens the drawing; a stranger cannot', async ({
    browser,
    request,
  }) => {
    const ts = Date.now();
    const emailA = `two_user_a_${ts}@canvhq.internal`;
    const wantedEmailB = `two_user_b_${ts}@canvhq.internal`;
    const emailC = `two_user_c_${ts}@canvhq.internal`;
    const workspaceName = `Two Users ${ts}`;
    const projectName = `Shared Project ${ts}`;

    // ---------------------------------------------------------------- User A: workspace, board, invite
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const userA = await createTestUserSession(request, contextA, emailA, `Owner ${ts}`);
    // The invitee signs in first: on the production image its address is chosen by the server.
    const contextB = await browser.newContext();
    const emailB = (await createTestUserSession(request, contextB, wantedEmailB, `Colleague ${ts}`))
      .email;

    await pageA.goto('/create-workspace');
    await completePassphrase(pageA);
    await expect(pageA).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await pageA.fill('#workspace-name', workspaceName);
    await pageA.fill('#project-name', projectName);
    await pageA.click('button[id="submit-btn"]');
    await expect(pageA).toHaveURL(/\/w\//, { timeout: 20000 });

    await pageA.locator('button:has-text("New Canvas")').first().click();
    await expect(pageA).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });
    await expect(pageA.locator('.excalidraw')).toBeVisible({ timeout: 15000 });
    const boardUrl = pageA.url();
    const boardId = boardUrl.split('/canvas/')[1] ?? '';
    const slug = new URL(boardUrl).pathname.split('/')[2] ?? '';
    await drawRectangle(pageA);

    await pageA.goto(`/w/${slug}/management`);
    await expect(pageA.getByRole('button', { name: /Manage Access/i })).toBeVisible({
      timeout: 20000,
    });

    await pageA.getByRole('button', { name: /Invite member/i }).click();
    await pageA.fill('#invite-email', emailB);
    await pageA.locator(`label:has-text("${projectName}") input[type="checkbox"]`).check();

    const [inviteResponse] = await Promise.all([
      pageA.waitForResponse(
        (response) =>
          response.url().includes('/members/invite') && response.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Send Invite' }).click(),
    ]);
    expect(inviteResponse.status()).toBe(201);
    const inviteBody: unknown = await inviteResponse.json();
    const inviteUrl =
      typeof inviteBody === 'object' &&
      inviteBody !== null &&
      'inviteUrl' in inviteBody &&
      typeof inviteBody.inviteUrl === 'string'
        ? inviteBody.inviteUrl
        : '';
    expect(inviteUrl).toContain('/invite/');

    // ---------------------------------------------------------------- User B: join and wait
    const pageB = await contextB.newPage();
    await pageB.goto(inviteUrl);
    await completePassphrase(pageB);

    await expect(pageB).toHaveURL(/\/w\//, { timeout: 25000 });
    await expect(pageB.getByText('Waiting for access')).toBeVisible({ timeout: 20000 });
    await expect(
      pageB.getByText(/An administrator needs to grant you access/i).first(),
    ).toBeVisible();
    await expect(pageB.getByRole('button', { name: /New Canvas/i })).toHaveCount(0);

    // The board URL is reachable as a row but not openable: same message, no editor.
    await pageB.goto(boardUrl);
    await expect(pageB.getByText('Waiting for access')).toBeVisible({ timeout: 20000 });
    await expect(pageB.locator('.excalidraw')).toHaveCount(0);

    // ---------------------------------------------------------------- User A: grants access
    await pageA.getByRole('button', { name: /Manage Access/i }).click();
    await expect(pageA.getByText('Pending access')).toBeVisible({ timeout: 15000 });
    await pageA.getByRole('button', { name: 'Grant access' }).click();

    // Demo accounts share one name, so the dialog cannot be matched to the invitee by name; this
    // workspace has exactly one pending grant.
    const grantDialog = pageA.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantDialog).toBeVisible({ timeout: 20000 });

    const [grantResponse] = await Promise.all([
      pageA.waitForResponse(
        (response) => response.url().includes('/members') && response.request().method() === 'POST',
      ),
      grantDialog.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);
    expect(grantResponse.status()).toBe(201);

    // ---------------------------------------------------------------- User B: the drawing is there
    await pageB.reload();
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect(pageB.getByText('Could not decrypt this canvas')).toHaveCount(0);
    await expect.poll(() => sceneElementCount(pageB), { timeout: 15000 }).toBeGreaterThan(0);

    // ---------------------------------------------------------------- User C: a stranger
    const contextC = await browser.newContext();
    await createTestUserSession(request, contextC, emailC, `Stranger ${ts}`);

    const publicKeyRes = await contextC.request.get(`${API}/api/user/public-key/${userA.userId}`);
    expect(publicKeyRes.status()).toBe(404);

    const workspaceRes = await contextA.request.get(`${API}/api/workspaces/${slug}`);
    expect(workspaceRes.ok()).toBeTruthy();
    const workspaceBody: unknown = await workspaceRes.json();
    const workspaceId =
      typeof workspaceBody === 'object' &&
      workspaceBody !== null &&
      'id' in workspaceBody &&
      typeof workspaceBody.id === 'string'
        ? workspaceBody.id
        : '';
    expect(workspaceId).not.toBe('');

    const projectsRes = await contextA.request.get(`${API}/api/projects`, {
      headers: { 'active-organization': workspaceId },
    });
    expect(projectsRes.ok()).toBeTruthy();
    const projectsBody = await projectsRes.json();
    const projects: Array<{ id: string; name: string }> = Array.isArray(projectsBody)
      ? projectsBody
      : projectsBody.items;
    const projectId = projects.find((project) => project.name === projectName)?.id;
    expect(projectId).toBeTruthy();

    const membersRes = await contextC.request.get(`${API}/api/projects/${projectId}/members`, {
      headers: { 'active-organization': workspaceId },
    });
    expect([403, 404]).toContain(membersRes.status());

    const boardRes = await contextC.request.get(`${API}/api/boards/${boardId}`, {
      headers: { 'active-organization': workspaceId },
    });
    expect([403, 404]).toContain(boardRes.status());

    await signOutContext(contextC);
    await signOutContext(contextB);
    await signOutContext(contextA);
  });
});
