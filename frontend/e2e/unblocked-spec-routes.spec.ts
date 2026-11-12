import { test, expect } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';

test.describe.serial('CanvHQ Public Specification Routes Access & Modal Exemption', () => {
  const timestamp = Date.now();
  const testEmail = `spec_access_${timestamp}@canvhq.internal`;
  const testName = `Spec User ${timestamp}`;
  const passphrase = 'PassphraseForSpec123!';

  test('1. Unauthenticated visitors can freely access /security and /terms without being blocked', async ({
    page,
  }) => {
    // 1. Visit /security
    await page.goto('/security');
    await expect(page.locator('h1:has-text("How CanvHQ protects your canvases")')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#new-encryption-passphrase')).not.toBeVisible();
    await expect(page.locator('#current-encryption-passphrase')).not.toBeVisible();

    // 2. Visit /terms
    await page.goto('/terms');
    await expect(page.locator('h1:has-text("Terms and Conditions")')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#new-encryption-passphrase')).not.toBeVisible();
    await expect(page.locator('#current-encryption-passphrase')).not.toBeVisible();

    // 3. Visit /privacy
    await page.goto('/privacy');
    await expect(page.locator('h1:has-text("Privacy Notice")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#new-encryption-passphrase')).not.toBeVisible();
    await expect(page.locator('#current-encryption-passphrase')).not.toBeVisible();
  });

  test('2. Authenticated user without encryption setup can access /security, /terms, and /privacy without modal, but is blocked on other routes', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Create a new authenticated user whose encryption is NOT initialized yet
    await createTestUserSession(request, context, testEmail, testName);

    // 1. Visit /security as logged-in uninitialized user -> Must NOT show encryption setup modal
    await page.goto('/security');
    await expect(page.locator('h1:has-text("How CanvHQ protects your canvases")')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#new-encryption-passphrase')).not.toBeVisible();

    // 2. Visit /terms as logged-in uninitialized user -> Must NOT show encryption setup modal
    await page.goto('/terms');
    await expect(page.locator('h1:has-text("Terms and Conditions")')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#new-encryption-passphrase')).not.toBeVisible();

    // 3. Visit /privacy as logged-in uninitialized user -> Must NOT show encryption setup modal
    await page.goto('/privacy');
    await expect(page.locator('h1:has-text("Privacy Notice")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#new-encryption-passphrase')).not.toBeVisible();

    // 4. Visit a non-exempt route like /create-workspace -> Must send the user to the passphrase page first
    await page.goto('/create-workspace');
    await expect(page).toHaveURL(/\/setup-passphrase\?next=%2Fcreate-workspace/, {
      timeout: 15000,
    });

    // Initialize encryption so we can test returning locked state in next test
    await page.fill('#passphrase', passphrase);
    await page.fill('#confirm-passphrase', passphrase);
    await page.check('#acknowledge-recovery');
    await page.click('#submit-passphrase-btn');
    await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await page.fill('#workspace-name', `Spec Org ${timestamp}`);
    await page.fill('#project-name', `Spec Project ${timestamp}`);
    await page.click('button[id="submit-btn"]');
    await expect(page).toHaveURL(/\/w\//, { timeout: 15000 });

    await context.close();
  });

  test('3. Authenticated user with locked session (empty IndexedDB) can access /security, /terms, and /privacy without unlock modal, but is prompted on workspace routes', async ({
    browser,
    request,
  }) => {
    // Open a fresh isolated context (simulating a second desktop with empty IndexedDB)
    const context = await browser.newContext();
    const page = await context.newPage();

    await createTestUserSession(request, context, testEmail, testName);

    // 1. Visit /security on new device with empty IndexedDB -> Must NOT show unlock modal
    await page.goto('/security');
    await expect(page.locator('h1:has-text("How CanvHQ protects your canvases")')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#current-encryption-passphrase')).not.toBeVisible();

    // 2. Visit /terms on new device with empty IndexedDB -> Must NOT show unlock modal
    await page.goto('/terms');
    await expect(page.locator('h1:has-text("Terms and Conditions")')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#current-encryption-passphrase')).not.toBeVisible();

    // 3. Visit /privacy on new device with empty IndexedDB -> Must NOT show unlock modal
    await page.goto('/privacy');
    await expect(page.locator('h1:has-text("Privacy Notice")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#current-encryption-passphrase')).not.toBeVisible();

    // 3. Visit a workspace route (/workspace) -> Must automatically prompt the Unlock Modal
    await page.goto('/workspace');
    await expect(page.locator('#current-encryption-passphrase')).toBeVisible({ timeout: 15000 });

    await context.close();
  });
});
