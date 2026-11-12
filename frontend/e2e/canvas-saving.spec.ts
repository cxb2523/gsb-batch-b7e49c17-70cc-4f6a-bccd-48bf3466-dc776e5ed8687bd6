import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { addImage, drawRectangle, sceneElementCount } from './scene-helpers';

/**
 * What a person relies on from a canvas: edits reach the server, opening a canvas never writes
 * anything by itself, coming back shows what was saved, and nothing is lost on the way out.
 */

const PASSPHRASE = 'CanvasSaving123!';
const PAYLOAD = /\/api\/boards\/[^/]+\/payload/;

const isPayloadWrite = (url: string, method: string) => PAYLOAD.test(url) && method === 'PUT';

async function startCanvas(
  page: Page,
  context: BrowserContext,
  request: Parameters<typeof createTestUserSession>[0],
) {
  const ts = Date.now();
  await createTestUserSession(request, context, `saving_${ts}@canvhq.internal`, `Saving ${ts}`);
  await page.goto('/create-workspace');
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
  await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
  await page.fill('#workspace-name', `Saving ${ts}`);
  await page.fill('#project-name', `Saving project ${ts}`);
  await page.click('button[id="submit-btn"]');
  await expect(page).toHaveURL(/\/w\//, { timeout: 25000 });
  const workspaceUrl = page.url();
  await page.locator('button:has-text("New Canvas")').first().click();
  await expect(page).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 20000 });
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
  return { workspaceUrl, canvasUrl: page.url() };
}

/** Counts the writes of a canvas payload this page sends. */
function countPayloadWrites(page: Page) {
  const counter = { writes: 0 };
  page.on('request', (req) => {
    if (isPayloadWrite(req.url(), req.method())) counter.writes += 1;
  });
  return counter;
}

async function waitForSavedState(page: Page) {
  await expect(page.locator('header').getByText('Saved', { exact: true })).toBeVisible({
    timeout: 15000,
  });
}

/** Draws, then waits until the server has stored the canvas. */
async function drawAndSave(page: Page, draw: () => Promise<void>) {
  const stored = page.waitForResponse(
    (res) => isPayloadWrite(res.url(), res.request().method()) && res.status() === 200,
  );
  await draw();
  await stored;
  // Edits that came in while that save was on its way get their own save, and the badge says
  // "Unsaved" until it is done, so "Saved" that holds for a while means nothing is left.
  await page.waitForTimeout(2500);
  await waitForSavedState(page);
}

function openCanvasInApp(page: Page) {
  return page.locator('a:has-text("Back")').first().click();
}

test.describe('Saving a canvas', () => {
  test('a canvas that is only opened writes nothing, new or saved', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { canvasUrl } = await startCanvas(page, context, request);
    const writes = countPayloadWrites(page);

    // New: opened, scrolled around and left alone.
    const canvas = page.locator('canvas.excalidraw__canvas.interactive').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Excalidraw canvas has no bounding box');
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(3500);
    expect(writes.writes, 'a new canvas was written to before any edit').toBe(0);

    // Saved: the same, after one real edit.
    await drawAndSave(page, () => drawRectangle(page));
    expect(writes.writes).toBe(1);
    await page.goto(canvasUrl);
    await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(3500);
    expect(writes.writes, 'a saved canvas was written to by opening it').toBe(1);

    await context.close();
  });

  test('leaving the canvas inside the app after a save and coming back shows the work, without a conflict', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    await startCanvas(page, context, request);

    await drawAndSave(page, async () => {
      await drawRectangle(page);
      await drawRectangle(page);
      await addImage(page);
    });
    await openCanvasInApp(page);
    await expect(page).not.toHaveURL(/\/canvas\//);
    // Long enough for the workspace page to settle: what comes back is the canvas from the cache.
    await page.waitForTimeout(1500);
    await page.goBack();
    await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });

    await expect.poll(() => sceneElementCount(page), { timeout: 15000 }).toBe(3);
    await expect(page.getByText('This canvas was changed elsewhere.')).toHaveCount(0);
    await expect(page.locator('header').getByText('Saved', { exact: true })).toBeVisible();

    await context.close();
  });

  test('leaving with unsaved changes asks first, and nothing is lost either way', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { canvasUrl } = await startCanvas(page, context, request);

    await drawRectangle(page);
    await openCanvasInApp(page);

    const dialog = page.getByRole('dialog', { name: 'Leave this canvas?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay on this canvas' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/canvas\//);
    expect(await sceneElementCount(page)).toBe(1);

    // Once it has been saved the way out is open.
    await waitForSavedState(page);
    await openCanvasInApp(page);
    await expect(page).not.toHaveURL(/\/canvas\//);
    await page.goto(canvasUrl);
    await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => sceneElementCount(page), { timeout: 15000 }).toBe(1);

    // Leaving anyway still sends the edit.
    await drawRectangle(page);
    await openCanvasInApp(page);
    const sentOnLeaving = page.waitForResponse(
      (res) => isPayloadWrite(res.url(), res.request().method()) && res.status() === 200,
    );
    await dialog.getByRole('button', { name: 'Leave anyway' }).click();
    await expect(page).not.toHaveURL(/\/canvas\//);
    // The app is still running, so the edit goes out while the workspace page is open.
    await sentOnLeaving;
    await page.goto(canvasUrl);
    await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => sceneElementCount(page), { timeout: 15000 }).toBe(2);

    await context.close();
  });

  test('closing the tab with unsaved changes asks the browser to confirm', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await startCanvas(page, context, request);

    const prompts: string[] = [];
    page.on('dialog', (dialog) => {
      prompts.push(dialog.type());
      void dialog.dismiss();
    });

    await drawRectangle(page);
    await page.close({ runBeforeUnload: true });
    await expect
      .poll(() => prompts, { message: 'no confirmation while the edit was unsaved' })
      .toEqual(['beforeunload']);
    expect(page.isClosed()).toBe(false);

    // Nothing to confirm once it is saved.
    await waitForSavedState(page);
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(prompts).toEqual(['beforeunload']);

    await context.close();
  });

  test('after a conflict, Reload opens the server copy and Restore brings back the local edit', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const { canvasUrl } = await startCanvas(pageA, context, request);

    const pageB = await context.newPage();
    await pageB.goto(canvasUrl);
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });

    // Another session saves first.
    await drawAndSave(pageA, () => drawRectangle(pageA));

    // This session edits from the old revision and is told so.
    await drawRectangle(pageB);
    await expect(pageB.getByText('This canvas was changed elsewhere.')).toBeVisible({
      timeout: 15000,
    });

    // The canvas is taken down while the server copy is fetched, and mounted again after.
    const serverCopy = pageB.waitForResponse(
      (res) => PAYLOAD.test(res.url()) && res.request().method() === 'GET',
    );
    await pageB.getByRole('button', { name: 'Reload' }).click();
    await serverCopy;
    await expect(pageB.getByText('This canvas was changed elsewhere.')).toHaveCount(0);
    await expect(pageB.locator('canvas.excalidraw__canvas.interactive').first()).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => sceneElementCount(pageB), { timeout: 15000 }).toBe(1);

    // The edit it was making is offered back, and lands on top of the copy it just opened.
    await pageB.getByRole('button', { name: 'Restore unsaved changes' }).click();
    await waitForSavedState(pageB);
    await pageB.goto(canvasUrl);
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => sceneElementCount(pageB), { timeout: 15000 }).toBe(2);

    await context.close();
  });
});
