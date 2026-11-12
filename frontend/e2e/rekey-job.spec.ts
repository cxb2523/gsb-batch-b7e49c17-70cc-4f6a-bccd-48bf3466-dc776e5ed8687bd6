import { test, expect, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { addImage, openCanvasShowingImage } from './scene-helpers';
import { API_URL } from './constants';
import { openBoardPayload } from '../src/lib/crypto-format';

declare global {
  interface Window {
    /** Set by the test-only init script below; the application never defines it. */
    testUnwrappedKeys?: CryptoKey[];
  }
}

const PASSPHRASE = 'RekeyJob123!';

/** Records every key the page unwraps, so the test can ask what a removed person could still open. */
function captureUnwrappedKeys() {
  const keys: CryptoKey[] = [];
  window.testUnwrappedKeys = keys;
  const unwrapKey = SubtleCrypto.prototype.unwrapKey.bind(crypto.subtle);
  SubtleCrypto.prototype.unwrapKey = async (...args: Parameters<SubtleCrypto['unwrapKey']>) => {
    const key = await unwrapKey(...args);
    keys.push(key);
    return key;
  };
}

async function exportUnwrappedKeys(page: Page): Promise<number[][]> {
  return page.evaluate(async () => {
    const extractable = (window.testUnwrappedKeys ?? []).filter(
      (key) => key.extractable && key.algorithm.name === 'AES-GCM',
    );
    return Promise.all(
      extractable.map(async (key) =>
        Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', key))),
      ),
    );
  });
}

function payloadHeader(payload: Uint8Array) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return { keyVersion: view.getUint32(1, false), revision: view.getUint32(5, false) };
}

async function canOpen(rawKey: number[], payload: Uint8Array, boardId: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(rawKey), 'AES-GCM', false, [
    'decrypt',
  ]);
  const { keyVersion, revision } = payloadHeader(payload);
  try {
    await openBoardPayload(key, payload, { boardId, keyVersion, revision });
    return true;
  } catch {
    return false;
  }
}

async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

/** Adds an image to the open canvas and waits until the save that stores it has finished. */
async function addImageAndSave(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (res) =>
      res.url().includes('/payload') && res.request().method() === 'PUT' && res.status() === 200,
  );
  await addImage(page);
  await saved;
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
}

async function newCanvasWithImage(page: Page, slug: string): Promise<string> {
  await page.goto(`/w/${slug}`);
  await page.locator('button:has-text("New Canvas")').first().click();
  await expect(page).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 20000 });
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
  await addImageAndSave(page);
  return page.url();
}

const boardIdOf = (canvasUrl: string) => canvasUrl.split('/canvas/')[1] ?? '';

test.describe('CanvHQ E2E: background re-key after a removal (Batch 17b)', () => {
  test('secures every canvas with its images in the owner’s browser, keeps the public-link canvas, and cuts the removed member off', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180000);
    const ts = Date.now();
    const emailA = `rekey_owner_${ts}@canvhq.internal`;
    const wantedEmailB = `rekey_member_${ts}@canvhq.internal`;
    const projectName = `Rekey Project ${ts}`;

    // ------------------------------------------------ Owner A: workspace, three canvases with images
    const contextA = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const pageA = await contextA.newPage();
    await createTestUserSession(request, contextA, emailA, `Owner A ${ts}`);
    // The invitee signs in first: on the production image its address is chosen by the server.
    const contextB = await browser.newContext();
    await contextB.addInitScript(captureUnwrappedKeys);
    const emailB = (await createTestUserSession(request, contextB, wantedEmailB, `Member B ${ts}`))
      .email;
    await pageA.goto('/create-workspace');
    await completePassphrase(pageA);
    await expect(pageA).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await pageA.fill('#workspace-name', `Rekey WS ${ts}`);
    await pageA.fill('#project-name', projectName);
    await pageA.click('button[id="submit-btn"]');
    await expect(pageA).toHaveURL(/\/w\//, { timeout: 25000 });
    const slug = new URL(pageA.url()).pathname.split('/')[2] ?? '';

    const canvas1Url = await newCanvasWithImage(pageA, slug);
    const canvas2Url = await newCanvasWithImage(pageA, slug);
    const canvas3Url = await newCanvasWithImage(pageA, slug);
    const [canvas1, canvas2, canvas3] = [canvas1Url, canvas2Url, canvas3Url].map(boardIdOf);
    if (!canvas1 || !canvas2 || !canvas3) throw new Error('canvas ids missing');

    // Canvas 3 gets a public link, so it keeps its key by rule.
    await pageA.locator('button[title="Share Canvas"]').click();
    await pageA.locator('button[role="switch"]').click();
    await pageA.getByRole('button', { name: /Copy Public Link/i }).click();
    const publicUrl = await pageA.evaluate(() => navigator.clipboard.readText());
    expect(publicUrl).toContain('#key=');

    // ------------------------------------------------ Member B joins the project and opens canvas 1
    await pageA.goto(`/w/${slug}/management`);
    await expect(pageA.getByRole('button', { name: /Manage Access/i })).toBeVisible({
      timeout: 20000,
    });
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
    const inviteUrl = (await inviteRes.json()).inviteUrl;

    const pageB = await contextB.newPage();
    await pageB.goto(inviteUrl);
    await completePassphrase(pageB);
    await expect(pageB).toHaveURL(/\/w\//, { timeout: 40000 });

    await pageA.reload();
    await pageA.getByRole('button', { name: /Manage Access/i }).click();
    await pageA.getByRole('button', { name: 'Grant access' }).first().click();
    const grantDialog = pageA.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantDialog).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      grantDialog.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);

    await openCanvasShowingImage(pageB, canvas1Url, 1);
    const oldPayloadRes = await contextB.request.get(`${API_URL}/api/boards/${canvas1}/payload`);
    const oldPayload = new Uint8Array(await oldPayloadRes.body());
    expect(payloadHeader(oldPayload).keyVersion).toBe(1);
    const bKeys = await exportUnwrappedKeys(pageB);
    expect(bKeys.length).toBeGreaterThan(0);

    // ------------------------------------------------ Owner A removes B: the project key rotates
    await pageA.goto(`/w/${slug}/management`);
    const removeButton = pageA
      .locator('div')
      .filter({ hasText: emailB })
      .locator('button[title="Remove member"]')
      .first();
    await expect(removeButton).toBeVisible({ timeout: 15000 });
    await removeButton.click();
    await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/rotate-key') && res.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Remove Member', exact: true }).click(),
    ]);

    // Nothing has opened a canvas yet: both private canvases are still behind the new key.
    const queueUrl = `${API_URL}/api/workspaces/${slug}/rekey-queue`;
    await expect
      .poll(async () => (await (await contextA.request.get(queueUrl)).json()).boards.length, {
        timeout: 20000,
      })
      .toBeGreaterThan(0);

    // ------------------------------------------------ The job runs in A's browser, canvases closed
    await pageA.goto(`/w/${slug}`);
    await expect
      .poll(async () => (await (await contextA.request.get(queueUrl)).json()).boards.length, {
        timeout: 60000,
      })
      .toBe(0);
    await expect(pageA.getByText(/keeps its current key/)).toBeVisible({ timeout: 15000 });
    expect((await (await contextA.request.get(queueUrl)).json()).skippedPublic).toBe(1);

    // Both private canvases are now stored under the new key; the public one kept its key.
    const versionOf = async (boardId: string) =>
      payloadHeader(
        new Uint8Array(
          await (await contextA.request.get(`${API_URL}/api/boards/${boardId}/payload`)).body(),
        ),
      );
    expect((await versionOf(canvas1)).keyVersion).toBe(2);
    expect((await versionOf(canvas2)).keyVersion).toBe(2);
    expect((await versionOf(canvas3)).keyVersion).toBe(1);

    // ------------------------------------------------ B is cut off; A and the public link still read everything
    const newPayload = new Uint8Array(
      await (await contextA.request.get(`${API_URL}/api/boards/${canvas1}/payload`)).body(),
    );
    const opensOld = await Promise.all(bKeys.map((key) => canOpen(key, oldPayload, canvas1)));
    expect(opensOld).toContain(true);
    const opensNew = await Promise.all(bKeys.map((key) => canOpen(key, newPayload, canvas1)));
    expect(opensNew).not.toContain(true);
    expect([403, 404]).toContain(
      (await contextB.request.get(`${API_URL}/api/boards/${canvas1}/payload`)).status(),
    );

    await openCanvasShowingImage(pageA, canvas1Url, 1);
    await openCanvasShowingImage(pageA, canvas2Url, 1);

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await openCanvasShowingImage(publicPage, publicUrl);

    await publicContext.close();
    await contextB.close();
    await contextA.close();
  });
});
