import { test, expect } from '@playwright/test';
import { completePassphrasePage, createTestUserSession } from './e2ee-test-helpers';

const PASSPHRASE = 'NotificationsPassphrase123!';

test.describe('Notifications', () => {
  test('an owner hears that an invitee joined, and the invitee hears that access was granted, without reloading', async ({
    browser,
    request,
  }) => {
    const ts = Date.now();
    const projectName = `Roadmap ${ts}`;

    // The invitee signs in first: on the production image its address is chosen by the server.
    const inviteeContext = await browser.newContext();
    const inviteeEmail = (
      await createTestUserSession(
        request,
        inviteeContext,
        `notify_invitee_${ts}@canvhq.internal`,
        'Ivy Invitee',
      )
    ).email;

    // ---------------------------------------------------------------- Owner sets up and invites
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await createTestUserSession(
      request,
      ownerContext,
      `notify_owner_${ts}@canvhq.internal`,
      'Owen',
    );
    await ownerPage.goto('/create-workspace');
    await completePassphrasePage(ownerPage, PASSPHRASE);
    await expect(ownerPage).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await ownerPage.fill('#workspace-name', `Notify Workspace ${ts}`);
    await ownerPage.fill('#project-name', projectName);
    await ownerPage.click('button[id="submit-btn"]');
    await expect(ownerPage).toHaveURL(/\/w\//, { timeout: 20000 });
    const slug = new URL(ownerPage.url()).pathname.split('/')[2] ?? '';

    await ownerPage.goto(`/w/${slug}/management`);
    await ownerPage.getByRole('button', { name: /Invite member/i }).click();
    await ownerPage.fill('#invite-email', inviteeEmail);
    await ownerPage.locator(`label:has-text("${projectName}") input[type="checkbox"]`).check();
    const [inviteResponse] = await Promise.all([
      ownerPage.waitForResponse(
        (response) =>
          response.url().includes('/members/invite') && response.request().method() === 'POST',
      ),
      ownerPage.getByRole('button', { name: 'Send Invite' }).click(),
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

    // The owner keeps this page open and does not touch it again until the bell changes.
    await ownerPage.goto(`/w/${slug}`);
    await expect(ownerPage.getByRole('button', { name: 'Notifications' })).toBeVisible({
      timeout: 15000,
    });

    // ---------------------------------------------------------------- Invitee accepts
    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto(inviteUrl);
    await completePassphrasePage(inviteePage, PASSPHRASE);
    await expect(inviteePage).toHaveURL(/\/w\//, { timeout: 25000 });
    await expect(inviteePage.getByRole('button', { name: 'Notifications' })).toBeVisible({
      timeout: 15000,
    });

    // ---------------------------------------------------------------- The owner's bell changes by itself
    await expect(ownerPage.getByTestId('unread-count')).toHaveText('1', { timeout: 15000 });
    await ownerPage.getByRole('button', { name: /Notifications/ }).click();
    // The person's name is theirs to choose (a demo account has its own), so it is not asserted.
    const joined = ownerPage.getByText(
      new RegExp(
        `joined Notify Workspace ${ts}\\. 1 project is waiting for you to grant access\\.`,
      ),
    );
    await expect(joined).toBeVisible();

    // It leads to where the access is granted
    await joined.click();
    await expect(ownerPage).toHaveURL(new RegExp(`/w/.+/management`), { timeout: 15000 });
    await expect(ownerPage.getByTestId('unread-count')).toHaveCount(0, { timeout: 15000 });

    // ---------------------------------------------------------------- Owner grants access
    await ownerPage.getByRole('button', { name: /Manage Access/i }).click();
    await expect(ownerPage.getByText('Pending access')).toBeVisible({ timeout: 15000 });
    await ownerPage.getByRole('button', { name: 'Grant access' }).click();
    const grantDialog = ownerPage.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantDialog).toBeVisible({ timeout: 20000 });
    const [grantResponse] = await Promise.all([
      ownerPage.waitForResponse(
        (response) => response.url().includes('/members') && response.request().method() === 'POST',
      ),
      grantDialog.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);
    expect(grantResponse.status()).toBe(201);

    // ---------------------------------------------------------------- The invitee's bell changes by itself
    await expect(inviteePage.getByTestId('unread-count')).toHaveText('1', { timeout: 15000 });
    await inviteePage.getByRole('button', { name: /Notifications/ }).click();
    await expect(
      inviteePage.getByText(`You now have access to ${projectName} in Notify Workspace ${ts}.`),
    ).toBeVisible();

    // Marking everything read clears the badge
    await inviteePage.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(inviteePage.getByTestId('unread-count')).toHaveCount(0, { timeout: 15000 });

    await ownerContext.close();
    await inviteeContext.close();
  });
});
