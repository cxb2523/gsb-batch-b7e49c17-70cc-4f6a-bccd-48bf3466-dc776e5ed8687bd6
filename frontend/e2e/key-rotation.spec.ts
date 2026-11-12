import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { API_URL } from './constants';
import { sceneElementCount } from './scene-helpers';
import { openBoardPayload } from '../src/lib/crypto-format';

declare global {
  interface Window {
    /** Set by the test-only init script below; the application never defines it. */
    testUnwrappedKeys?: CryptoKey[];
  }
}

/**
 * Records every key the page unwraps, so the test can ask what a removed person's browser could
 * still do with them. It lives in the test, not in the application.
 */
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

/** The raw bytes of every AES key the page unwrapped (the application unwraps them extractable). */
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

/** Runs the application's own payload decoder, so version and board binding are checked too. */
async function canOpenBoardPayload(
  rawKey: number[],
  payload: Uint8Array,
  boardId: string,
  keyVersion: number,
  revision = 1,
): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(rawKey), 'AES-GCM', false, [
    'decrypt',
  ]);
  try {
    const rev =
      payload.length >= 9 && payload[0] === 0x01
        ? new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(5, false)
        : revision;
    await openBoardPayload(key, payload, { boardId, keyVersion, revision: rev });
    return true;
  } catch {
    return false;
  }
}

const PASSPHRASE = 'PassphraseKeyRot123!';
const API = API_URL;

async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

async function drawRectangle(page: Page): Promise<void> {
  const canvas = page.locator('canvas.excalidraw__canvas.interactive').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Excalidraw canvas has no bounding box');
  }

  const startX = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.6;

  await page.locator('button[aria-label="Rectangle"]').click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY + 110, { steps: 20 });
  await page.mouse.up();

  await expect.poll(() => sceneElementCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function drawAdditionalShape(page: Page): Promise<void> {
  const canvas = page.locator('canvas.excalidraw__canvas.interactive').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Excalidraw canvas has no bounding box');
  }

  const startX = box.x + box.width * 0.25;
  const startY = box.y + box.height * 0.25;

  await page.locator('button[aria-label="Diamond"]').click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 90, { steps: 20 });
  await page.mouse.up();

  await page.waitForResponse(
    (res) =>
      res.url().includes('/payload') && res.request().method() === 'PUT' && res.status() === 200,
    { timeout: 20000 },
  );
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function signOutContext(context: BrowserContext): Promise<void> {
  await context.close();
}

test.describe('CanvHQ E2E: Key rotation on removal (four users, PRD 4.11)', () => {
  test('Admin A rotates key on B removal; C edits without error; B is cryptographically cut off; E opens all boards', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120000);
    const ts = Date.now();
    const emailA = `rot_admin_a_${ts}@canvhq.internal`;
    const wantedEmailB = `rot_member_b_${ts}@canvhq.internal`;
    const wantedEmailC = `rot_member_c_${ts}@canvhq.internal`;
    const wantedEmailE = `rot_member_e_${ts}@canvhq.internal`;
    const workspaceName = `Rotation WS ${ts}`;
    const projectName = `Rotation Project ${ts}`;

    // ---------------------------------------------------------------- User A: create workspace and two boards
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await createTestUserSession(request, contextA, emailA, `Admin A ${ts}`);
    // The invitees sign in first: on the production image their addresses are chosen by the server.
    const contextB = await browser.newContext();
    await contextB.addInitScript(captureUnwrappedKeys);
    const emailB = (await createTestUserSession(request, contextB, wantedEmailB, `Member B ${ts}`))
      .email;
    const contextC = await browser.newContext();
    const emailC = (await createTestUserSession(request, contextC, wantedEmailC, `Member C ${ts}`))
      .email;
    const contextE = await browser.newContext();
    const emailE = (await createTestUserSession(request, contextE, wantedEmailE, `Member E ${ts}`))
      .email;

    await pageA.goto('/create-workspace');
    await completePassphrase(pageA);
    await expect(pageA).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await pageA.fill('#workspace-name', workspaceName);
    await pageA.fill('#project-name', projectName);
    await pageA.click('button[id="submit-btn"]');
    await expect(pageA).toHaveURL(/\/w\//, { timeout: 20000 });

    const slug = new URL(pageA.url()).pathname.split('/')[2] ?? '';

    // Board 1
    await pageA.locator('button:has-text("New Canvas")').first().click();
    await expect(pageA).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });
    await expect(pageA.locator('.excalidraw')).toBeVisible({ timeout: 15000 });
    const board1Url = pageA.url();
    const board1Id = board1Url.split('/canvas/')[1] ?? '';
    await drawRectangle(pageA);

    // Board 2
    await pageA.goto(`/w/${slug}`);
    await pageA.locator('button:has-text("New Canvas")').first().click();
    await expect(pageA).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });
    await expect(pageA.locator('.excalidraw')).toBeVisible({ timeout: 15000 });
    const board2Url = pageA.url();
    await drawRectangle(pageA);

    // ---------------------------------------------------------------- User A: Invite B and C
    await pageA.goto(`/w/${slug}/management`);
    await expect(pageA.getByRole('button', { name: /Manage Access/i })).toBeVisible({
      timeout: 20000,
    });

    // Invite Member B
    await pageA.getByRole('button', { name: /Invite member/i }).click();
    await pageA.fill('#invite-email', emailB);
    await pageA.locator(`label:has-text("${projectName}") input[type="checkbox"]`).check();
    const [inviteBRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/invite') && res.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Send Invite' }).click(),
    ]);
    expect(inviteBRes.status()).toBe(201);
    const inviteBJson = await inviteBRes.json();
    const inviteUrlB = inviteBJson.inviteUrl;

    // Invite Member C
    await pageA.getByRole('button', { name: /Invite member/i }).click();
    await pageA.fill('#invite-email', emailC);
    await pageA.locator(`label:has-text("${projectName}") input[type="checkbox"]`).check();
    const [inviteCRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/invite') && res.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Send Invite' }).click(),
    ]);
    expect(inviteCRes.status()).toBe(201);
    const inviteCJson = await inviteCRes.json();
    const inviteUrlC = inviteCJson.inviteUrl;

    // ---------------------------------------------------------------- Member B accepts
    const pageB = await contextB.newPage();
    await pageB.goto(inviteUrlB);
    await completePassphrase(pageB);
    await expect(pageB).toHaveURL(/\/w\//, { timeout: 25000 });

    // ---------------------------------------------------------------- Member C accepts
    const pageC = await contextC.newPage();
    await pageC.goto(inviteUrlC);
    await completePassphrase(pageC);
    await expect(pageC).toHaveURL(/\/w\//, { timeout: 25000 });

    // ---------------------------------------------------------------- Admin A grants B and C
    await pageA.reload();
    await pageA.getByRole('button', { name: /Manage Access/i }).click();
    await expect(pageA.getByText('Pending access').first()).toBeVisible({ timeout: 15000 });

    // Grant B
    const grantBtns = pageA.getByRole('button', { name: 'Grant access' });
    await grantBtns.first().click();
    const grantModalB = pageA.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantModalB).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      grantModalB.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);

    // Grant C
    await expect(pageA.getByRole('button', { name: 'Grant access' }).first()).toBeVisible({
      timeout: 15000,
    });
    await pageA.getByRole('button', { name: 'Grant access' }).first().click();
    const grantModalC = pageA.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantModalC).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      grantModalC.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);

    // ---------------------------------------------------------------- Member B opens Board 1
    await pageB.goto(board1Url);
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => sceneElementCount(pageB), { timeout: 15000 }).toBeGreaterThan(0);

    // What B legitimately held before removal: the v1 payload and every key B's browser unwrapped.
    const bOldPayloadRes = await contextB.request.get(`${API}/api/boards/${board1Id}/payload`);
    expect(bOldPayloadRes.ok()).toBeTruthy();
    const bOldPayload = new Uint8Array(await bOldPayloadRes.body());
    const bKeys = await exportUnwrappedKeys(pageB);
    expect(bKeys.length).toBeGreaterThan(0);

    // ---------------------------------------------------------------- Member C opens Board 1
    await pageC.goto(board1Url);
    await expect(pageC.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => sceneElementCount(pageC), { timeout: 15000 }).toBeGreaterThan(0);

    // ---------------------------------------------------------------- Admin A removes Member B
    await pageA.goto(`/w/${slug}/management`);
    const removeBtn = pageA
      .locator('div')
      .filter({ hasText: emailB })
      .locator('button[title="Remove member"]')
      .first();
    await expect(removeBtn).toBeVisible({ timeout: 15000 });
    await removeBtn.click();

    const [deleteRes, rotateRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/') && res.request().method() === 'DELETE',
      ),
      pageA.waitForResponse(
        (res) => res.url().includes('/rotate-key') && res.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Remove Member', exact: true }).click(),
    ]);
    expect(deleteRes.status()).toBe(200);
    expect(rotateRes.status()).toBe(200);

    // Rotation runs automatically in Admin A's browser
    await expect(pageA.locator('text=Securing')).not.toBeVisible({ timeout: 20000 });

    // ---------------------------------------------------------------- Member C edits Board 1 while rotation is active
    await drawAdditionalShape(pageC);
    await expect(pageC.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
    await expect(pageC.locator('.sonner-toast[data-type="error"]')).toHaveCount(0);

    // ---------------------------------------------------------------- Member B is cryptographically cut off
    // 1. HTTP cut-off: 403 or 404
    const bFetchBoard = await contextB.request.get(`${API}/api/boards/${board1Id}`);
    expect([403, 404]).toContain(bFetchBoard.status());

    const bFetchPayload = await contextB.request.get(`${API}/api/boards/${board1Id}/payload`);
    expect([403, 404]).toContain(bFetchPayload.status());

    // 2. Cryptographic cut-off: B's old key cannot decrypt the new payload
    const newPayloadRes = await contextA.request.get(`${API}/api/boards/${board1Id}/payload`);
    expect(newPayloadRes.ok()).toBeTruthy();
    const newPayloadBytes = new Uint8Array(await newPayloadRes.body());

    // Verify the header of the new payload is version 2
    expect(newPayloadBytes[0]).toBe(0x01);
    const payloadKeyVersion = new DataView(
      newPayloadBytes.buffer,
      newPayloadBytes.byteOffset,
      newPayloadBytes.byteLength,
    ).getUint32(1, false);
    expect(payloadKeyVersion).toBe(2);

    // Positive control: B's keys do open the payload B held before removal, so the refusal below
    // is about the key and not about a broken helper.
    const bOpensOld = await Promise.all(
      bKeys.map((key) => canOpenBoardPayload(key, bOldPayload, board1Id, 1)),
    );
    expect(bOpensOld).toContain(true);
    const bOpensNew = await Promise.all(
      bKeys.map((key) => canOpenBoardPayload(key, newPayloadBytes, board1Id, 2)),
    );
    expect(bOpensNew).not.toContain(true);

    // ---------------------------------------------------------------- User E (added after rotation)
    await pageA.goto(`/w/${slug}/management`);
    await pageA.getByRole('button', { name: /Invite member/i }).click();
    await pageA.fill('#invite-email', emailE);
    await pageA.locator(`label:has-text("${projectName}") input[type="checkbox"]`).check();
    const [inviteERes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/invite') && res.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Send Invite' }).click(),
    ]);
    expect(inviteERes.status()).toBe(201);
    const inviteEJson = await inviteERes.json();
    const inviteUrlE = inviteEJson.inviteUrl;

    const pageE = await contextE.newPage();
    await pageE.goto(inviteUrlE);
    await completePassphrase(pageE);
    await expect(pageE).toHaveURL(/\/w\//, { timeout: 25000 });

    // Admin A grants User E
    await pageA.reload();
    await pageA.getByRole('button', { name: /Manage Access/i }).click();
    await pageA.getByRole('button', { name: 'Grant access' }).first().click();
    const grantModalE = pageA.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantModalE).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      grantModalE.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);

    // User E opens Board 2 (never re-saved, opens via history chain v2 -> v1)
    await pageE.goto(board2Url);
    await expect(pageE.locator('.excalidraw')).toBeVisible({ timeout: 25000 });
    await expect.poll(() => sceneElementCount(pageE), { timeout: 20000 }).toBeGreaterThan(0);

    // User E opens Board 1 (saved by C under v2)
    await pageE.goto(board1Url);
    await expect(pageE.locator('.excalidraw')).toBeVisible({ timeout: 25000 });
    await expect.poll(() => sceneElementCount(pageE), { timeout: 20000 }).toBeGreaterThan(0);

    // ---------------------------------------------------------------- Admin A reloads and verifies project key version
    await pageA.goto(`/w/${slug}`);
    const projectRes = await contextA.request.get(`${API}/api/projects`, {
      headers: { 'active-organization': slug },
    });
    expect(projectRes.ok()).toBeTruthy();
    const projectsData = await projectRes.json();
    const projectsList: Array<{ name: string; keyVersion: number }> = Array.isArray(projectsData)
      ? projectsData
      : projectsData.items;
    const currentProject = projectsList.find((p) => p.name === projectName);
    expect(currentProject?.keyVersion).toBe(2);

    await signOutContext(contextE);
    await signOutContext(contextC);
    await signOutContext(contextB);
    await signOutContext(contextA);
  });
});
