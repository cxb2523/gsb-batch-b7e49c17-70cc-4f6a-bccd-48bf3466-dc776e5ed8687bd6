import { test, expect } from '@playwright/test';
import {
  createTestUserSession,
  completePassphrasePage,
  unlockWorkspaceSession,
  queryIndexedDBKey,
  attemptKeyExport,
  countIndexedDBKeys,
} from './e2ee-test-helpers';

test.describe.serial('CanvHQ account passphrase and device key handling', () => {
  const timestamp = Date.now();
  const passphraseA = 'MasterPassphrase123!';
  const passphraseB = 'RotatedPassphrase456!';
  const email = `admin_e2ee_${timestamp}@canvhq.internal`;
  const name = `Admin E2EE ${timestamp}`;

  let workspaceSlug: string;
  let boardUrl: string;

  test('a fresh device rejects a wrong passphrase, then unlocks the same canvas', async ({
    browser,
    request,
  }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await createTestUserSession(request, contextA, email, name);

    await pageA.goto('/create-workspace');
    await completePassphrasePage(pageA, passphraseA);
    await expect(pageA).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await pageA.fill('#workspace-name', `Crypto Corp ${timestamp}`);
    await pageA.fill('#project-name', `Core Network ${timestamp}`);
    await pageA.click('button[id="submit-btn"]');
    await expect(pageA).toHaveURL(/\/w\//, { timeout: 20000 });

    const slug = pageA.url().match(/\/w\/([^/]+)/)?.[1];
    if (!slug) {
      throw new Error('workspace slug missing from the URL');
    }
    workspaceSlug = slug;

    await pageA.locator('button:has-text("New Canvas")').first().click();
    await expect(pageA).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });
    await expect(pageA.locator('.excalidraw')).toBeVisible({ timeout: 15000 });
    boardUrl = pageA.url();
    await contextA.close();

    // A second device: same account, empty IndexedDB.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await createTestUserSession(request, contextB, email, name);
    await pageB.goto(boardUrl);

    await unlockWorkspaceSession(pageB, 'WrongPassphrase999!', true);
    await unlockWorkspaceSession(pageB, passphraseA, false);
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect(pageB.getByText('Could not decrypt this canvas')).toHaveCount(0);
    expect(pageB.url()).not.toContain('#key=');

    await contextB.close();
  });

  test('a rotated passphrase replaces the old one and earlier canvases still open', async ({
    browser,
    request,
  }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await createTestUserSession(request, contextA, email, name);

    await pageA.goto(`/w/${workspaceSlug}`);
    await unlockWorkspaceSession(pageA, passphraseA, false);

    await pageA.goto('/profile#security');
    await expect(pageA.locator('text=Security & Encryption Passphrase')).toBeVisible({
      timeout: 15000,
    });
    await pageA.fill('#current-passphrase', passphraseA);
    await pageA.fill('#new-passphrase', passphraseB);
    await pageA.fill('#confirm-new-passphrase', passphraseB);
    await pageA.click('button:has-text("Change Encryption Passphrase")');
    await expect(pageA.locator('text=Encryption passphrase updated successfully.')).toBeVisible({
      timeout: 15000,
    });

    // A third device must use the new passphrase.
    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    await createTestUserSession(request, contextC, email, name);
    await pageC.goto(boardUrl);

    await unlockWorkspaceSession(pageC, passphraseA, true);
    await unlockWorkspaceSession(pageC, passphraseB, false);
    await expect(pageC.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect(pageC.getByText('Could not decrypt this canvas')).toHaveCount(0);

    await contextA.close();
    await contextC.close();
  });

  test('the cached private key is non-extractable and signing out purges it', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const user = await createTestUserSession(request, context, email, name);

    await page.goto(`/w/${workspaceSlug}`);
    await unlockWorkspaceSession(page, passphraseB, false);

    const keyInfo = await queryIndexedDBKey(page, user.userId);
    expect(keyInfo.exists).toBe(true);
    expect(keyInfo.extractable).toBe(false);

    const exportResult = await attemptKeyExport(page, user.userId);
    expect(exportResult.found).toBe(true);
    expect(exportResult.extractable).toBe(false);
    expect(exportResult.exported).toBe(false);
    expect(exportResult.errorName).toBe('InvalidAccessError');

    await page.locator('button[aria-label="User profile and account settings"]').click();
    await page.locator('button:has-text("Log Out")').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

    // Sign-out may still be reloading the page, which destroys the context a query runs in;
    // retry both reads together until the page settles.
    await expect(async () => {
      expect(await countIndexedDBKeys(page)).toBe(0);
      expect((await queryIndexedDBKey(page, user.userId)).exists).toBe(false);
    }).toPass({ timeout: 15000 });

    await context.close();
  });
});
