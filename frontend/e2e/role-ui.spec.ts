import { test, expect, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';

const PASSPHRASE = 'RoleUiPassphrase123!';

async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

test.describe('Role-aware UI (Batch 15b)', () => {
  test('Owner controls, Editor restrictions, and ownership transfer without reload', async ({
    browser,
    request,
  }) => {
    const ts = Date.now();
    const emailA = `owner_${ts}@canvhq.internal`;
    const emailB = `colleague_${ts}@canvhq.internal`;
    const workspaceName = `Role UI Org ${ts}`;
    const projectName = `Alpha Project ${ts}`;

    // ---------------------------------------------------------------- Step 1: Owner creates workspace
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await createTestUserSession(request, contextA, emailA, `Alice Owner ${ts}`);

    await pageA.goto('/create-workspace');
    await completePassphrase(pageA);
    await expect(pageA).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await pageA.fill('#workspace-name', workspaceName);
    await pageA.fill('#project-name', projectName);
    await pageA.click('button[id="submit-btn"]');
    await expect(pageA).toHaveURL(/\/w\//, { timeout: 25000 });

    const slug = new URL(pageA.url()).pathname.split('/')[2] ?? '';

    // Verify Owner role badge in AppHeader
    const roleBadgeA = pageA.getByTestId('role-badge');
    await expect(roleBadgeA).toBeVisible({ timeout: 15000 });
    await expect(roleBadgeA).toHaveText(/owner/i);

    // Verify Create Workspace in switcher
    const switcherTriggerA = pageA.locator('aside').locator('button[aria-expanded]');
    await switcherTriggerA.click();
    await expect(
      pageA.locator('aside').getByRole('button', { name: /Create Workspace/i }),
    ).toBeVisible();
    await switcherTriggerA.click(); // Close switcher

    // Navigate to Management
    await pageA.goto(`/w/${slug}/management`);
    await expect(pageA.getByTestId('project-role-badge').first()).toBeVisible({ timeout: 15000 });
    await expect(pageA.getByTestId('project-role-badge').first()).toHaveText(
      'Admin · all projects',
    );
    await expect(pageA.getByRole('button', { name: /Delete Workspace/i })).toBeVisible();

    // ---------------------------------------------------------------- Step 2: Owner invites User B
    await pageA.getByRole('button', { name: /Invite member/i }).click();
    await pageA.fill('#invite-email', emailB);
    await pageA.locator(`label:has-text("${projectName}") input[type="checkbox"]`).check();

    const [inviteRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/invite') && res.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Send Invite' }).click(),
    ]);
    expect(inviteRes.status()).toBe(201);
    const inviteJson = await inviteRes.json();
    const inviteUrl = inviteJson.inviteUrl;

    // ---------------------------------------------------------------- Step 3: User B accepts invite
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await createTestUserSession(request, contextB, emailB, `Bob Colleague ${ts}`);
    await pageB.goto(inviteUrl);
    await completePassphrase(pageB);
    await expect(pageB).toHaveURL(/\/w\//, { timeout: 25000 });

    // ---------------------------------------------------------------- Step 4: Owner grants access to User B
    await pageA.reload();
    await pageA.getByRole('button', { name: /Manage Access/i }).click();
    await expect(pageA.getByText('Pending access').first()).toBeVisible({ timeout: 15000 });
    const grantBtns = pageA.getByRole('button', { name: 'Grant access' });
    await grantBtns.first().click();
    const grantModal = pageA.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantModal).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      grantModal.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);

    // ---------------------------------------------------------------- Step 5: User B as Editor checks
    await pageB.goto(`/w/${slug}`);
    const roleBadgeB = pageB.getByTestId('role-badge');
    await expect(roleBadgeB).toBeVisible({ timeout: 15000 });
    await expect(roleBadgeB).toHaveText(/editor/i);

    // Workspace switcher hides "Create Workspace" for Editor
    const switcherTriggerB = pageB.locator('aside').locator('button[aria-expanded]');
    await switcherTriggerB.click();
    await expect(
      pageB.locator('aside').getByRole('button', { name: /Create Workspace/i }),
    ).not.toBeVisible();
    await switcherTriggerB.click(); // Close switcher

    // Direct navigation to /create-workspace displays dead-end card
    await pageB.goto('/create-workspace');
    await expect(pageB.getByText("You can't create another workspace")).toBeVisible({
      timeout: 15000,
    });
    await expect(pageB.getByText('Return to Workspace')).toBeVisible();

    // In project list, role badge says Editor
    await pageB.goto(`/w/${slug}`);
    await expect(pageB.getByText(projectName).first()).toBeVisible({ timeout: 15000 });

    // An editor is not offered Management, and a guessed address sends them home with a reason
    await expect(pageB.getByRole('link', { name: 'Management' })).toHaveCount(0);
    // Nor is "Add members": a project Editor cannot manage who else is in the project.
    await expect(pageB.getByRole('button', { name: /New Canvas/ })).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Add members' })).toHaveCount(0);
    await pageB.goto(`/w/${slug}/management`);
    await expect(
      pageB.getByText('Only workspace owners and admins can open management.'),
    ).toBeVisible({ timeout: 15000 });
    await expect(pageB).toHaveURL(new RegExp(`/w/${slug}(\\?|$)`));
    await expect(pageB.getByRole('heading', { name: 'Workspace Management' })).toHaveCount(0);

    // ---------------------------------------------------------------- Step 6: Owner promotes User B to Admin
    await pageA.goto(`/w/${slug}/management`);
    const roleSelectB = pageA
      .locator('#members')
      .locator(`select[aria-label="Role for Bob Colleague ${ts}"]`);
    await expect(roleSelectB).toBeVisible({ timeout: 15000 });

    const [promoteRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/') && res.request().method() === 'PATCH',
      ),
      roleSelectB.selectOption('admin'),
    ]);
    expect(promoteRes.status()).toBe(200);

    // ---------------------------------------------------------------- Step 7: Ownership transfer
    // "Transfer ownership" button appears on Admin row
    const transferBtn = pageA.getByRole('button', { name: 'Transfer ownership' });
    await expect(transferBtn).toBeVisible({ timeout: 15000 });
    await transferBtn.click();

    // Confirm dialog is shown
    const transferDialog = pageA.getByRole('dialog');
    await expect(transferDialog).toBeVisible();
    await expect(
      pageA.getByText(
        `Bob Colleague ${ts} becomes the Owner. You become an Admin. Only the Owner can delete the workspace or transfer it again.`,
      ),
    ).toBeVisible();

    // Confirm transfer without reload
    const confirmTransferBtn = transferDialog.getByRole('button', { name: 'Transfer ownership' });
    const [transferRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/transfer-ownership') && res.request().method() === 'POST',
      ),
      confirmTransferBtn.click(),
    ]);
    expect([200, 201]).toContain(transferRes.status());

    // Without reloading, former Owner's badge updates to ADMIN and Owner-only controls disappear
    await expect(roleBadgeA).toHaveText(/admin/i, { timeout: 15000 });
    await expect(pageA.getByRole('button', { name: /Delete Workspace/i })).not.toBeVisible();
    await expect(pageA.getByRole('button', { name: 'Transfer ownership' })).not.toBeVisible();

    // ---------------------------------------------------------------- Step 8: User B is now the Owner
    await pageB.goto(`/w/${slug}/management`);
    await expect(pageB.getByTestId('role-badge')).toHaveText(/owner/i, { timeout: 15000 });
    await expect(pageB.getByRole('button', { name: /Delete Workspace/i })).toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});
