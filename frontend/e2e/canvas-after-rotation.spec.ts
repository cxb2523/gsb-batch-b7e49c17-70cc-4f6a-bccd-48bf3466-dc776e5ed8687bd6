import { test, expect, type Page } from '@playwright/test';
import { createTestUserSession } from './e2ee-test-helpers';

const PASSPHRASE = 'RotationCanvasPassphrase123!';
const CANVAS = 'canvas.excalidraw__canvas.interactive';
const CANNOT_DECRYPT = 'Could not decrypt this canvas';

async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

/** Creates a canvas from the project page and returns its id once the editor is up. */
async function createCanvas(page: Page): Promise<string> {
  await page
    .getByRole('button', { name: /New Canvas/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/canvas\//, { timeout: 20000 });
  await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(CANNOT_DECRYPT)).toHaveCount(0);
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

async function drawRectangle(page: Page): Promise<void> {
  const box = await page.locator(CANVAS).first().boundingBox();
  if (!box) throw new Error('Excalidraw canvas has no bounding box');
  await page.locator('button[aria-label="Rectangle"]').click();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 120, box.y + box.height * 0.5 + 80, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
}

async function expectOpens(page: Page, slug: string, id: string, who: string): Promise<void> {
  await page.goto(`/w/${slug}/canvas/${id}`);
  await expect(page.locator(CANVAS).first(), `${who} opens ${id}`).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(CANNOT_DECRYPT), `${who} decrypts ${id}`).toHaveCount(0);
}

/** Each canvas in turn, in one person's browser (a page can only show one at a time). */
function expectOpensInOrder(page: Page, slug: string, ids: string[], who: string): Promise<void> {
  return ids.reduce(
    (previous, id) => previous.then(() => expectOpens(page, slug, id, who)),
    Promise.resolve(),
  );
}

async function acceptInvitation(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await completePassphrase(page);
  await expect(page).toHaveURL(/\/w\//, { timeout: 25000 });
}

/** In the Owner's project access dialog: completes the first pending grant. */
async function grantFirstPending(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Grant access' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Grant access to/ });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/members') && r.request().method() === 'POST'),
    dialog.getByRole('button', { name: 'Confirm and grant' }).click(),
  ]);
  await expect(dialog).toHaveCount(0);
}

/**
 * A canvas made after the project key has rotated used to be sealed as key version 1 while the
 * server (and the browser opening it) called it the project's version, so nobody could open it
 * again. Rotation happens whenever somebody is removed from a project; this runs two of them and
 * has an Owner and a Project Admin (only an Editor in the workspace) create and open canvases in
 * between.
 */
test.describe('Canvases made after a key rotation', { tag: '@journeys-1' }, () => {
  test('stay openable for the Owner and for a Project Admin, across two rotations', async ({
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const signedIn = async (label: string) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const user = await createTestUserSession(
        request,
        context,
        `${label}_${ts}@canvhq.internal`,
        `${label} ${ts}`,
      );
      return { page, user, name: `${label} ${ts}` };
    };

    const owner = await signedIn('owner');
    await owner.page.goto('/create-workspace');
    await completePassphrase(owner.page);
    await expect(owner.page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await owner.page.fill('#workspace-name', `Rotation ${ts}`);
    await owner.page.fill('#project-name', 'Tech');
    await owner.page.click('button[id="submit-btn"]');
    await expect(owner.page).toHaveURL(/\/w\//, { timeout: 25000 });
    const slug = new URL(owner.page.url()).pathname.split('/')[2] ?? '';

    // A canvas from before any rotation, with something drawn in it.
    const beforeRotation = await createCanvas(owner.page);
    await drawRectangle(owner.page);
    await owner.page.goto(`/w/${slug}`);

    const pia = await signedIn('pia');
    const carl = await signedIn('carl');
    await owner.page.goto(`/w/${slug}/management`);
    const invite = async (email: string) => {
      await owner.page.getByRole('button', { name: /Invite member/i }).click();
      await owner.page.fill('#invite-email', email);
      await owner.page.locator('label:has-text("Tech") input[type="checkbox"]').check();
      const [res] = await Promise.all([
        owner.page.waitForResponse(
          (r) => r.url().includes('/members/invite') && r.request().method() === 'POST',
        ),
        owner.page.getByRole('button', { name: 'Send Invite' }).click(),
      ]);
      return (await res.json()).inviteUrl;
    };
    const piaLink = await invite(pia.user.email);
    const carlLink = await invite(carl.user.email);
    await acceptInvitation(pia.page, piaLink);
    await acceptInvitation(carl.page, carlLink);

    // The Owner grants both, makes Pia admin of the project, then removes Carl: rotation one.
    await owner.page.reload();
    await owner.page.getByRole('button', { name: /Manage Access/i }).click();
    await grantFirstPending(owner.page);
    await grantFirstPending(owner.page);
    const access = owner.page.getByRole('dialog');
    await Promise.all([
      owner.page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'PATCH',
      ),
      access.locator(`select[aria-label="Role for ${pia.name}"]`).selectOption('admin'),
    ]);
    await Promise.all([
      owner.page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'DELETE',
      ),
      access.locator('.grid', { hasText: carl.name }).getByTitle('Unassign from project').click(),
    ]);
    await owner.page.waitForTimeout(6000);

    // The Project Admin makes a canvas on the rotated project; both can open both canvases.
    await pia.page.goto(`/w/${slug}`);
    const afterFirst = await createCanvas(pia.page);
    await drawRectangle(pia.page);
    const firstTwo = [beforeRotation, afterFirst];
    await Promise.all([
      expectOpensInOrder(owner.page, slug, firstTwo, 'the Owner'),
      expectOpensInOrder(pia.page, slug, firstTwo, 'the Project Admin'),
    ]);

    // The Project Admin adds Carl and removes him again (the Owner re-keys on their next visit):
    // rotation two. Then both make another canvas and everyone opens all four.
    await pia.page.goto(`/w/${slug}`);
    await pia.page.getByRole('button', { name: 'Add members' }).click();
    const piaDialog = pia.page.getByRole('dialog');
    await piaDialog
      .getByLabel('Workspace member to assign')
      .selectOption({ label: `${carl.name} (${carl.user.email})` });
    await Promise.all([
      pia.page.waitForResponse(
        (r) => r.url().includes('/members') && r.request().method() === 'POST',
      ),
      piaDialog.getByRole('button', { name: 'Assign Member' }).click(),
    ]);
    await Promise.all([
      pia.page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'DELETE',
      ),
      piaDialog
        .locator('.grid', { hasText: carl.name })
        .getByTitle('Unassign from project')
        .click(),
    ]);
    await owner.page.goto(`/w/${slug}`);
    await owner.page.waitForTimeout(8000);
    const ownerAfterSecond = await createCanvas(owner.page);
    await drawRectangle(owner.page);
    await pia.page.goto(`/w/${slug}`);
    const piaAfterSecond = await createCanvas(pia.page);

    const all = [beforeRotation, afterFirst, ownerAfterSecond, piaAfterSecond];
    await Promise.all([
      expectOpensInOrder(owner.page, slug, all, 'the Owner'),
      expectOpensInOrder(pia.page, slug, all, 'the Project Admin'),
    ]);
  });
});
