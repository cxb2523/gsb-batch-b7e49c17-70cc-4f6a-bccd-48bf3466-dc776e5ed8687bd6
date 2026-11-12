import { test, expect, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { sceneElementCount } from './scene-helpers';

const PASSPHRASE = 'PassphraseFirst123!';

/** Completes the passphrase page and returns to `next` (or /workspace). */
async function completePassphrasePage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

async function createWorkspaceAndBoard(page: Page, ts: number): Promise<string> {
  // Passphrase first: /create-workspace sends an uninitialised user to setup and back.
  await page.goto('/create-workspace');
  await completePassphrasePage(page);
  await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });

  await page.fill('#workspace-name', `Mesh Org ${ts}`);
  await page.fill('#project-name', `Core Infra ${ts}`);
  await page.click('button[id="submit-btn"]');
  await expect(page).toHaveURL(/\/w\//, { timeout: 20000 });

  await page.locator('button:has-text("New Canvas")').first().click();
  await expect(page).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 15000 });

  return page.url();
}

async function drawSomething(page: Page): Promise<void> {
  const canvas = page.locator('canvas.excalidraw__canvas.interactive').first();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Excalidraw canvas has no bounding box');
  }

  // Draw in the middle of the canvas, away from the floating toolbars and properties panel.
  const startX = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.6;

  await page.locator('button[aria-label="Rectangle"]').click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY + 110, { steps: 20 });
  await page.mouse.up();

  await expect.poll(() => sceneElementCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1200);
}

test.describe('CanvHQ E2E: passphrase-first E2EE lifecycle', () => {
  test('creates a workspace and a canvas with keys, and never puts a key in the URL', async ({
    page,
  }) => {
    const ts = Date.now();
    await createTestUserSession(
      page.request,
      page.context(),
      `canvas_e2e_${ts}@canvhq.internal`,
      `Arch Lead ${ts}`,
    );

    const captured: Array<{ contentType: string | null; body: Buffer | null }> = [];
    page.on('request', (request) => {
      if (
        request.method() === 'PUT' &&
        request.url().includes('/api/boards/') &&
        request.url().includes('/payload')
      ) {
        captured.push({
          contentType: request.headers()['content-type'] ?? null,
          body: request.postDataBuffer(),
        });
      }
    });

    const boardUrl = await createWorkspaceAndBoard(page, ts);

    // Internal boards carry no key in the URL any more.
    expect(new URL(boardUrl).hash).toBe('');

    await drawSomething(page);

    expect(captured.length).toBeGreaterThan(0);
    const payload = captured.at(-1);
    if (!payload) {
      throw new Error('expected a captured payload');
    }
    expect(payload.contentType).toContain('application/octet-stream');
    const body = payload.body?.toString('utf-8') ?? '';
    expect(body).not.toContain('"type":"rectangle"');
    expect(body).not.toContain('canvhq_key_');

    // The same browser re-opens the board from the account hierarchy alone.
    await page.reload();
    await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Could not decrypt this canvas')).toHaveCount(0);
  });

  test('the same user reads the same board from a fresh browser context (C4)', async ({
    browser,
    request,
  }) => {
    const ts = Date.now();
    const email = `fresh_context_${ts}@canvhq.internal`;
    const title = `Fresh Context Canvas ${ts}`;

    // Context A: set the passphrase, create a workspace and a board, draw, save.
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await createTestUserSession(request, contextA, email, `Fresh Context ${ts}`);
    const boardUrl = await createWorkspaceAndBoard(pageA, ts);

    const header = pageA.locator('header');
    await header.locator('text=Untitled').click();
    const titleInput = header.locator('input[type="text"]');
    await titleInput.fill(title);
    await titleInput.press('Enter');
    await expect(header.locator(`text=${title}`)).toBeVisible();

    await drawSomething(pageA);
    await contextA.close();

    // Context B: no cookies, no IndexedDB, no localStorage. Sign in, open the same URL, unlock.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await createTestUserSession(request, contextB, email, `Fresh Context ${ts}`);
    await pageB.goto(boardUrl);

    await expect(pageB.locator('#current-encryption-passphrase')).toBeVisible({ timeout: 15000 });
    await pageB.fill('#current-encryption-passphrase', PASSPHRASE);
    await pageB.click('button:has-text("Unlock Canvases")');

    // The editor mounts only after the stored payload decrypted; a wrong/missing key shows the
    // blocked panel instead.
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect(pageB.getByText('Could not decrypt this canvas')).toHaveCount(0);
    await expect(pageB.locator('header').locator(`text=${title}`)).toBeVisible();

    // The drawing is actually there: an empty or undecryptable scene would have no elements.
    await expect.poll(() => sceneElementCount(pageB), { timeout: 15000 }).toBeGreaterThan(0);

    await contextB.close();
  });

  test('a payload that cannot be decrypted blocks the canvas and is never overwritten', async ({
    page,
  }) => {
    const ts = Date.now();
    await createTestUserSession(
      page.request,
      page.context(),
      `corrupt_${ts}@canvhq.internal`,
      'Corrupt Payload',
    );

    await createWorkspaceAndBoard(page, ts);
    await drawSomething(page);

    // From now on the stored payload is unreadable, as if the key did not match.
    await page.route('**/payload', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          // A valid v1 header for this board's key version with a deliberately broken body:
          // the client recognises the format and reports a decryption failure, never a new board.
          body: Buffer.from([
            0x01,
            0x00,
            0x00,
            0x00,
            0x01,
            ...Array.from({ length: 40 }, (_, index) => index + 1),
          ]),
        });
      } else {
        await route.continue();
      }
    });

    let putsAfterReload = 0;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('/payload')) {
        putsAfterReload += 1;
      }
    });

    await page.reload();

    await expect(page.getByText('Could not decrypt this canvas')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.excalidraw')).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(putsAfterReload).toBe(0);
  });
});
