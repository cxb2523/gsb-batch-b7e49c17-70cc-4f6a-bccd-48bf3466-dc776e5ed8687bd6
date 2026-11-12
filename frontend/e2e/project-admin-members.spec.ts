import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';

const PASSPHRASE = 'ProjectAdminPassphrase123!';

async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

async function signedInPage(
  browser: Browser,
  request: APIRequestContext,
  email: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await createTestUserSession(request, context, email, name);
  return { context, page };
}

/** The owner invites `email` as an editor and returns the link, optionally pre-assigning the project. */
async function invite(page: Page, email: string, projectName?: string): Promise<string> {
  await page.getByRole('button', { name: /Invite member/i }).click();
  await page.fill('#invite-email', email);
  if (projectName) {
    await page.locator(`label:has-text("${projectName}") input[type="checkbox"]`).check();
  }
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/members/invite') && res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Send Invite' }).click(),
  ]);
  expect(response.status()).toBe(201);
  return (await response.json()).inviteUrl;
}

async function accept(page: Page, inviteUrl: string): Promise<void> {
  await page.goto(inviteUrl);
  await completePassphrase(page);
  await expect(page).toHaveURL(/\/w\//, { timeout: 25000 });
}

test.describe('Project Admins manage their own project', () => {
  test('a Project Admin who is only an Editor in the workspace adds and removes members from the project', async ({
    browser,
    request,
  }) => {
    // Four people, three passphrase setups and two invitations in one journey.
    test.setTimeout(150_000);
    const ts = Date.now();
    const projectName = `Shared Project ${ts}`;
    const pia = `Pia Projectadmin ${ts}`;
    const carl = `Carl Colleague ${ts}`;

    // ---------------------------------------------------------------- the Owner sets everything up
    const owner = await signedInPage(
      browser,
      request,
      `owner_${ts}@canvhq.internal`,
      `Olive Owner ${ts}`,
    );
    await owner.page.goto('/create-workspace');
    await completePassphrase(owner.page);
    await expect(owner.page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await owner.page.fill('#workspace-name', `Project Admin Org ${ts}`);
    await owner.page.fill('#project-name', projectName);
    await owner.page.click('button[id="submit-btn"]');
    await expect(owner.page).toHaveURL(/\/w\//, { timeout: 25000 });
    const slug = new URL(owner.page.url()).pathname.split('/')[2] ?? '';

    // The Owner is offered "Add members" inside the project, beside New Canvas.
    await expect(owner.page.getByRole('button', { name: 'Add members' })).toBeVisible({
      timeout: 15000,
    });
    await expect(owner.page.getByRole('button', { name: /New Canvas/ })).toBeVisible();

    await owner.page.goto(`/w/${slug}/management`);
    const piaInvite = await invite(owner.page, `pia_${ts}@canvhq.internal`, projectName);
    const carlInvite = await invite(owner.page, `carl_${ts}@canvhq.internal`);

    const piaSession = await signedInPage(browser, request, `pia_${ts}@canvhq.internal`, pia);
    await accept(piaSession.page, piaInvite);
    const carlSession = await signedInPage(browser, request, `carl_${ts}@canvhq.internal`, carl);
    await accept(carlSession.page, carlInvite);

    // The Owner completes Pia's pending grant, then makes her admin of this one project.
    await owner.page.reload();
    await owner.page.getByRole('button', { name: /Manage Access/i }).click();
    await owner.page.getByRole('button', { name: 'Grant access' }).first().click();
    const grantDialog = owner.page.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantDialog).toBeVisible({ timeout: 15000 });
    await Promise.all([
      owner.page.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      grantDialog.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);
    const piaRole = owner.page.getByRole('dialog').locator(`select[aria-label="Role for ${pia}"]`);
    await expect(piaRole).toBeVisible({ timeout: 15000 });

    // Pia, a project Editor, has no "Add members" and no Management.
    await piaSession.page.goto(`/w/${slug}`);
    await expect(piaSession.page.getByText(projectName).first()).toBeVisible({ timeout: 15000 });
    await expect(piaSession.page.getByRole('button', { name: /New Canvas/ })).toBeVisible();
    await expect(piaSession.page.getByRole('button', { name: 'Add members' })).toHaveCount(0);

    // A project Editor, who holds no workspace key, creates a canvas with the key from their own grant.
    await piaSession.page.getByRole('button', { name: /New Canvas/ }).click();
    await expect(piaSession.page).toHaveURL(/\/canvas\//, { timeout: 20000 });
    await piaSession.page.goto(`/w/${slug}`);

    // The dialog names the role plainly: it is the project role, not the workspace role.
    await expect(owner.page.getByText('These roles apply to this project only.')).toBeVisible();
    await expect(
      owner.page.getByText(/workspace role is changed under Workspace Members/),
    ).toBeVisible();
    await Promise.all([
      owner.page.waitForResponse(
        (res) => res.url().includes('/members/') && res.request().method() === 'PATCH',
      ),
      piaRole.selectOption({ label: 'Project admin' }),
    ]);

    // ---------------------------------------------------------------- the Project Admin takes over
    // No reload: she was already looking at the project. The bell tells her, and the page follows.
    await expect(
      piaSession.page.getByRole('button', { name: /Notifications, \d+ unread/ }),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(piaSession.page.getByRole('button', { name: 'Add members' })).toBeVisible({
      timeout: 15000,
    });
    await piaSession.page.getByRole('button', { name: /Notifications/ }).click();
    await piaSession.page
      .getByText(new RegExp(`Your role in ${projectName} \\(.*\\) is now project admin\\.`))
      .click();
    await expect(piaSession.page).toHaveURL(/\?project=/);
    await expect(piaSession.page.getByTestId('role-badge')).toHaveText(/editor/i);
    await expect(piaSession.page.getByRole('button', { name: 'Add members' })).toBeVisible();
    await expect(piaSession.page.getByRole('link', { name: 'Management' })).toHaveCount(0);

    await piaSession.page.getByRole('button', { name: 'Add members' }).click();
    const dialog = piaSession.page.getByRole('dialog');
    await expect(dialog.getByText(`Project Access · ${projectName}`)).toBeVisible();
    // The workspace-role sentence is for Owners and Admins only.
    await expect(dialog.getByText('These roles apply to this project only.')).toBeVisible();
    await expect(dialog.getByText(/Workspace Members/)).toHaveCount(0);

    // Carl is offered: he is in the workspace, not in this project. Pia herself and the Owner are not.
    const picker = dialog.getByLabel('Workspace member to assign');
    await expect(picker.locator('option', { hasText: carl })).toHaveCount(1, { timeout: 15000 });
    await expect(picker.locator('option', { hasText: pia })).toHaveCount(0);
    await expect(picker.locator('option', { hasText: `Olive Owner ${ts}` })).toHaveCount(0);

    // Her own row is read-only: she cannot demote or remove herself from here.
    const ownRow = dialog.locator('.grid', { hasText: pia });
    await expect(ownRow.getByTitle('Unassign from project')).toHaveCount(0);
    await expect(ownRow.locator('select')).toHaveCount(0);

    await picker.selectOption({ label: `${carl} (carl_${ts}@canvhq.internal)` });
    await dialog.getByLabel('Project role').selectOption('viewer');
    const [assignResponse] = await Promise.all([
      piaSession.page.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      dialog.getByRole('button', { name: 'Assign Member' }).click(),
    ]);
    expect(assignResponse.status()).toBe(201);
    await expect(dialog.locator(`select[aria-label="Role for ${carl}"]`)).toHaveValue('viewer', {
      timeout: 15000,
    });
    await expect(picker.locator('option', { hasText: carl })).toHaveCount(0);

    // Carl now sees the project and can open it, as a Viewer.
    await carlSession.page.goto(`/w/${slug}`);
    await expect(carlSession.page.getByText(projectName).first()).toBeVisible({ timeout: 15000 });
    await expect(carlSession.page.getByRole('button', { name: /New Canvas/ })).toHaveCount(0);
    await expect(carlSession.page.getByRole('button', { name: 'Add members' })).toHaveCount(0);

    // Pia removes Carl again. Only an Owner or Admin can replace the project key, so she is told so.
    await dialog.locator('.grid', { hasText: carl }).getByTitle('Unassign from project').click();
    await expect(
      piaSession.page.getByText(/the next time a workspace owner or admin opens this workspace/),
    ).toBeVisible({ timeout: 15000 });
    await expect(picker.locator('option', { hasText: carl })).toHaveCount(1, { timeout: 15000 });

    // Carl is told, live, and the project is gone from his list without a reload.
    await carlSession.page.getByRole('button', { name: /Notifications/ }).click();
    await expect(
      carlSession.page.getByText(new RegExp(`You were removed from ${projectName} in `)),
    ).toBeVisible({ timeout: 15000 });
    await expect(carlSession.page.getByRole('link', { name: new RegExp(projectName) })).toHaveCount(
      0,
    );

    // A guessed address is refused for Pia, who still has no Management.
    await piaSession.page.goto(`/w/${slug}/management`);
    await expect(
      piaSession.page.getByText('Only workspace owners and admins can open management.'),
    ).toBeVisible({ timeout: 15000 });

    // The Owner's next visit replaces the key that Pia could not.
    await owner.page.goto(`/w/${slug}`);
    await expect(owner.page.getByRole('button', { name: 'Add members' })).toBeVisible({
      timeout: 15000,
    });

    await Promise.all([
      owner.context.close(),
      piaSession.context.close(),
      carlSession.context.close(),
    ]);
  });
});
