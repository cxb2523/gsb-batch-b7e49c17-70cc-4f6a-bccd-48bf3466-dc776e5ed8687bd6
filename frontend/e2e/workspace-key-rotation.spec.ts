import { test, expect, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';
import { API_URL } from './constants';
import { sceneElementCount } from './scene-helpers';
import { openBoardPayload, unwrapProjectKeyFromWorkspace } from '../src/lib/crypto-format';

declare global {
  interface Window {
    /** Set by the test-only init script below; the application never defines it. */
    testUnwrappedKeys?: CryptoKey[];
  }
}

/**
 * Records every key the page unwraps, so the test can verify cryptographic cutoff
 * without modifying any application code.
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

/** Tests if a raw key can unwrap a workspace-wrapped project key. */
async function canUnwrapProjectKey(
  rawKey: number[],
  encryptedProjectKey: string,
  workspaceId: string,
  projectId: string,
  projectKeyVersion: number,
  workspaceKeyVersion: number,
): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(rawKey), 'AES-GCM', false, [
    'unwrapKey',
  ]);
  try {
    await unwrapProjectKeyFromWorkspace(encryptedProjectKey, key, {
      workspaceId,
      projectId,
      projectKeyVersion,
      workspaceKeyVersion,
    });
    return true;
  } catch {
    return false;
  }
}

const PASSPHRASE = 'PassphraseWsRot123!';
const API = API_URL;

/**
 * The role selector in a member's row, found by the member's email: demo accounts are all named
 * the same, so a name cannot tell them apart.
 */
function roleSelectFor(page: Page, email: string) {
  return page
    .locator('#members')
    .locator('div', { has: page.locator('select') })
    .filter({ hasText: email })
    .last()
    .locator('select');
}

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

test.describe('CanvHQ E2E: Workspace key rotation on admin demotion (Batch 13c)', () => {
  test('Owner A demotes Admin B; workspace key rotates, then projects; C edits without error; B is cryptographically cut off', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120000);
    const ts = Date.now();
    const emailA = `wsrot_owner_a_${ts}@canvhq.internal`;
    const wantedEmailB = `wsrot_admin_b_${ts}@canvhq.internal`;
    const wantedEmailC = `wsrot_editor_c_${ts}@canvhq.internal`;
    const workspaceName = `WS Rot ${ts}`;
    const projectName = `WS Rot Project ${ts}`;

    // ---------------------------------------------------------------- User A: create workspace and board
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await createTestUserSession(request, contextA, emailA, `Owner A ${ts}`);
    // The invitees sign in first: on the production image their addresses are chosen by the server.
    const contextB = await browser.newContext();
    await contextB.addInitScript(captureUnwrappedKeys);
    const emailB = (await createTestUserSession(request, contextB, wantedEmailB, `Admin B ${ts}`))
      .email;
    const contextC = await browser.newContext();
    const emailC = (await createTestUserSession(request, contextC, wantedEmailC, `Editor C ${ts}`))
      .email;

    await pageA.goto('/create-workspace');
    await completePassphrase(pageA);
    await expect(pageA).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await pageA.fill('#workspace-name', workspaceName);
    await pageA.fill('#project-name', projectName);
    await pageA.click('button[id="submit-btn"]');
    await expect(pageA).toHaveURL(/\/w\//, { timeout: 20000 });

    const slug = new URL(pageA.url()).pathname.split('/')[2] ?? '';

    // Create Board 1
    await pageA.locator('button:has-text("New Canvas")').first().click();
    await expect(pageA).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });
    await expect(pageA.locator('.excalidraw')).toBeVisible({ timeout: 15000 });
    const board1Url = pageA.url();
    const board1Id = board1Url.split('/canvas/')[1] ?? '';
    await drawRectangle(pageA);

    // Get project ID and workspace ID
    await pageA.goto(`/w/${slug}`);
    const wsRes = await contextA.request.get(`${API}/api/workspaces/${slug}`);
    expect(wsRes.ok()).toBeTruthy();
    const wsData = await wsRes.json();
    const workspaceId = wsData.id;

    const projectsRes = await contextA.request.get(`${API}/api/projects`, {
      headers: { 'active-organization': workspaceId },
    });
    expect(projectsRes.ok()).toBeTruthy();
    const projectsData = await projectsRes.json();
    const projectId = projectsData.items[0].id;
    const oldProjectEncryptedKey = projectsData.items[0].encryptedProjectKey;

    // ---------------------------------------------------------------- User A: Invite B and C
    await pageA.goto(`/w/${slug}/management`);
    await expect(pageA.getByRole('button', { name: /Manage Access/i })).toBeVisible({
      timeout: 20000,
    });

    // Invite Member B (workspace-level invitation, no direct project grant)
    await pageA.getByRole('button', { name: /Invite member/i }).click();
    await pageA.fill('#invite-email', emailB);
    const [inviteBRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/invite') && res.request().method() === 'POST',
      ),
      pageA.getByRole('button', { name: 'Send Invite' }).click(),
    ]);
    expect(inviteBRes.status()).toBe(201);
    const inviteBJson = await inviteBRes.json();
    const inviteUrlB = inviteBJson.inviteUrl;

    // Invite Member C (with project pre-assigned)
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

    // ---------------------------------------------------------------- Admin A promotes B and grants C
    await pageA.reload();

    // Promote B to Admin
    const roleSelectB = roleSelectFor(pageA, emailB);
    await expect(roleSelectB).toBeVisible({ timeout: 15000 });
    const [promoteRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/') && res.request().method() === 'PATCH',
      ),
      roleSelectB.selectOption('admin'),
    ]);
    expect(promoteRes.status()).toBe(200);

    // Grant C
    await pageA.getByRole('button', { name: /Manage Access/i }).click();
    await expect(pageA.getByText('Pending access').first()).toBeVisible({ timeout: 15000 });
    const grantBtns = pageA.getByRole('button', { name: 'Grant access' });
    await grantBtns.first().click();
    const grantModalC = pageA.getByRole('dialog', { name: /Grant access to/ });
    await expect(grantModalC).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members') && res.request().method() === 'POST',
      ),
      grantModalC.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);

    // ---------------------------------------------------------------- Admin B opens Board 1
    await pageB.goto(board1Url);
    await expect(pageB.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => sceneElementCount(pageB), { timeout: 15000 }).toBeGreaterThan(0);

    // B legitimate holds: v1 payload and unwrapped keys (including workspace key and board key)
    const bOldPayloadRes = await contextB.request.get(`${API}/api/boards/${board1Id}/payload`);
    expect(bOldPayloadRes.ok()).toBeTruthy();
    const bOldPayload = new Uint8Array(await bOldPayloadRes.body());
    const bKeys = await exportUnwrappedKeys(pageB);
    expect(bKeys.length).toBeGreaterThan(0);

    // Positive control: B holds a key that opens the pre-demotion project key wrap
    const bCanOpenOldProject = await Promise.all(
      bKeys.map((key) =>
        canUnwrapProjectKey(key, oldProjectEncryptedKey, workspaceId, projectId, 1, 1),
      ),
    );
    expect(bCanOpenOldProject).toContain(true);

    // ---------------------------------------------------------------- Member C opens Board 1
    await pageC.goto(board1Url);
    await expect(pageC.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => sceneElementCount(pageC), { timeout: 15000 }).toBeGreaterThan(0);

    // ---------------------------------------------------------------- Admin A demotes Admin B to Editor
    await pageA.goto(`/w/${slug}/management`);
    const roleSelectBDemote = roleSelectFor(pageA, emailB);
    await expect(roleSelectBDemote).toBeVisible({ timeout: 15000 });

    // Expect PATCH member -> POST workspace rotate-key -> POST project rotate-key
    const [demoteRes, wsRotateRes, projRotateRes] = await Promise.all([
      pageA.waitForResponse(
        (res) => res.url().includes('/members/') && res.request().method() === 'PATCH',
      ),
      pageA.waitForResponse(
        (res) =>
          res.url().includes('/workspaces/') &&
          res.url().includes('/rotate-key') &&
          res.request().method() === 'POST',
      ),
      pageA.waitForResponse(
        (res) =>
          res.url().includes('/projects/') &&
          res.url().includes('/rotate-key') &&
          res.request().method() === 'POST',
      ),
      roleSelectBDemote.selectOption('editor'),
    ]);
    expect(demoteRes.status()).toBe(200);
    expect(wsRotateRes.status()).toBe(200);
    expect(projRotateRes.status()).toBe(200);

    // Rotation progress clears
    await expect(pageA.locator('text=Securing')).not.toBeVisible({ timeout: 20000 });

    // ---------------------------------------------------------------- Member C edits Board 1
    await drawAdditionalShape(pageC);
    await expect(pageC.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
    await expect(pageC.locator('.sonner-toast[data-type="error"]')).toHaveCount(0);

    // ---------------------------------------------------------------- Cryptographic cut-off
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

    // Positive control: B's keys DO open the pre-demotion payload
    const bOpensOld = await Promise.all(
      bKeys.map((key) => canOpenBoardPayload(key, bOldPayload, board1Id, 1)),
    );
    expect(bOpensOld).toContain(true);

    // Refusal: B's keys CANNOT open the new board payload
    const bOpensNew = await Promise.all(
      bKeys.map((key) => canOpenBoardPayload(key, newPayloadBytes, board1Id, 2)),
    );
    expect(bOpensNew).not.toContain(true);

    // Refusal: B's keys CANNOT open the rewrapped project key
    const newProjectsRes = await contextA.request.get(`${API}/api/projects`, {
      headers: { 'active-organization': workspaceId },
    });
    expect(newProjectsRes.ok()).toBeTruthy();
    const newProjectsData = await newProjectsRes.json();
    const newProjectEncryptedKey = newProjectsData.items[0].encryptedProjectKey;

    const bCanOpenNewProject = await Promise.all(
      bKeys.map((key) =>
        canUnwrapProjectKey(key, newProjectEncryptedKey, workspaceId, projectId, 2, 2),
      ),
    );
    expect(bCanOpenNewProject).not.toContain(true);
  });
});
