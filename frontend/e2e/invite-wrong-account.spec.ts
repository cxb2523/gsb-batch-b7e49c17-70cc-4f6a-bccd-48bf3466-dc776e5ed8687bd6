import { test, expect } from '@playwright/test';
import { completePassphrasePage, createTestUserSession } from './e2ee-test-helpers';

const PASSPHRASE = 'WrongAccountPassphrase123!';

test.describe('Invitation opened with the wrong account', () => {
  test('is stopped before any passphrase setup, and signing out returns to the invitation', async ({
    browser,
    request,
  }) => {
    const ts = Date.now();
    const invitedEmail = `invited_${ts}@canvhq.internal`;

    // ---------------------------------------------------------------- Owner invites someone else
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await createTestUserSession(request, ownerContext, `owner_${ts}@canvhq.internal`, 'Owner');
    await ownerPage.goto('/create-workspace');
    await completePassphrasePage(ownerPage, PASSPHRASE);
    await expect(ownerPage).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await ownerPage.fill('#workspace-name', `Wrong Account ${ts}`);
    await ownerPage.fill('#project-name', `Project ${ts}`);
    await ownerPage.click('button[id="submit-btn"]');
    await expect(ownerPage).toHaveURL(/\/w\//, { timeout: 20000 });
    const slug = new URL(ownerPage.url()).pathname.split('/')[2] ?? '';

    await ownerPage.goto(`/w/${slug}/management`);
    await ownerPage.getByRole('button', { name: /Invite member/i }).click();
    await ownerPage.fill('#invite-email', invitedEmail);
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

    // ---------------------------------------------------------------- Somebody else opens the link
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await createTestUserSession(request, otherContext, `other_${ts}@canvhq.internal`, 'Other');
    await otherPage.goto(inviteUrl);

    const notice = otherPage.getByRole('alert');
    await expect(notice).toContainText('sent to a different account', { timeout: 15000 });
    await expect(notice).toContainText('i***@canvhq.internal');
    await expect(notice).toContainText(`other_${ts}@canvhq.internal`);

    // No passphrase setup, no workspace, no acceptance
    await expect(otherPage).toHaveURL(inviteUrl);
    await expect(otherPage.getByRole('button', { name: 'Accept & Enter Workspace' })).toHaveCount(
      0,
    );

    // Signing out comes back to the same invitation, with the sign-in options again
    await otherPage.getByRole('button', { name: /Sign out and use another account/i }).click();
    await expect(otherPage).toHaveURL(inviteUrl, { timeout: 15000 });
    await expect(otherPage.getByRole('alert')).toHaveCount(0);
    await expect(otherPage.getByText(/Sign in with your work account/i)).toBeVisible({
      timeout: 15000,
    });

    await ownerContext.close();
    await otherContext.close();
  });
});
