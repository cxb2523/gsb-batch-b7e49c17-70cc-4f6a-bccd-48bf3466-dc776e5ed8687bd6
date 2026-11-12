import { test, expect, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { addImage, drawRectangle, openCanvasShowingImage } from './scene-helpers';

const PASSPHRASE = 'ImagesAndConflicts123!';

async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

async function createWorkspaceAndCanvas(page: Page, ts: number): Promise<{ canvasUrl: string }> {
  await page.goto('/create-workspace');
  await completePassphrase(page);
  await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });

  await page.fill('#workspace-name', `Images Org ${ts}`);
  await page.fill('#project-name', `Images Project ${ts}`);
  await page.click('button[id="submit-btn"]');
  await expect(page).toHaveURL(/\/w\//, { timeout: 25000 });

  await page.locator('button:has-text("New Canvas")').first().click();
  await expect(page).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 20000 });
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });

  return { canvasUrl: page.url() };
}

test.describe('Images and save conflicts (Batch 17)', () => {
  test('add an image, save, reload, and view on public link', async ({ browser, request }) => {
    const ts = Date.now();
    const email = `images_user_${ts}@canvhq.internal`;
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();

    await createTestUserSession(request, context, email, `Image Owner ${ts}`);
    const { canvasUrl } = await createWorkspaceAndCanvas(page, ts);

    // 1. Add an image through the image tool and wait for the save that stores it
    const payloadSavePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/payload') && res.request().method() === 'PUT' && res.status() === 200,
    );
    const fileUploadPromise = page.waitForResponse(
      (res) =>
        /\/api\/boards\/[^/]+\/files\//.test(res.url()) &&
        res.request().method() === 'PUT' &&
        res.status() === 200,
    );
    await addImage(page);
    await fileUploadPromise;
    await payloadSavePromise;
    await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });

    // 2. Reload: the image file comes back from the server and the scene still holds it
    await openCanvasShowingImage(page, canvasUrl, 1);

    // 3. Open Share panel and create public link
    await page.locator('button[title="Share Canvas"]').click();
    const switchBtn = page.locator('button[role="switch"]');
    await expect(switchBtn).toBeVisible({ timeout: 10000 });
    await switchBtn.click();

    const copyBtn = page.getByRole('button', { name: /Copy Public Link/i });
    await expect(copyBtn).toBeVisible({ timeout: 10000 });
    await copyBtn.click();

    const publicUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(publicUrl).toContain('/share/');
    expect(publicUrl).toContain('#key=');

    // 4. A visitor with no account opens the link and gets the image too
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await openCanvasShowingImage(publicPage, publicUrl);

    await context.close();
    await publicContext.close();
  });

  test('two contexts edit the same canvas: second save triggers conflict banner and Overwrite succeeds', async ({
    browser,
    request,
  }) => {
    const ts = Date.now();
    const emailA = `conflict_a_${ts}@canvhq.internal`;
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    await createTestUserSession(request, contextA, emailA, `User A ${ts}`);
    const { canvasUrl } = await createWorkspaceAndCanvas(pageA, ts);

    // Open second page in same session/context navigating to the same canvas
    const pageB = await contextA.newPage();
    await pageB.goto(canvasUrl);
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });

    // Page A makes an edit (draws a rectangle)
    const storedByA = pageA.waitForResponse(
      (res) =>
        res.url().includes('/payload') && res.request().method() === 'PUT' && res.status() === 200,
    );
    await pageA.bringToFront();
    await drawRectangle(pageA);

    // Page A save succeeds: the server has stored it, not just the badge's starting "Saved"
    await storedByA;
    await expect(pageA.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });

    // Page B makes an edit on top of its stale revision
    await pageB.bringToFront();
    await drawRectangle(pageB);

    // Page B receives 409 and displays the conflict banner
    await expect(pageB.locator('text=This canvas was changed elsewhere.')).toBeVisible({
      timeout: 15000,
    });
    const overwriteBtn = pageB.getByRole('button', { name: 'Overwrite' });
    await expect(overwriteBtn).toBeVisible();

    // Page B clicks Overwrite
    await overwriteBtn.click();

    // Overwrite succeeds, banner disappears, status is Saved
    await expect(pageB.locator('text=This canvas was changed elsewhere.')).not.toBeVisible({
      timeout: 15000,
    });
    await expect(pageB.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });

    await contextA.close();
  });
});
