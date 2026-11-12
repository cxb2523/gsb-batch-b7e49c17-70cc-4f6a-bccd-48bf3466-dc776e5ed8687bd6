import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  addImage,
  drawRectangle,
  openCanvasShowingImage,
  sceneElementCount,
} from './scene-helpers';

/**
 * The journey a visitor takes on the production image: it runs only against that image
 * (`playwright.image.config.ts`, see e2e/README.md), because the dev server sends no content
 * security policy and has dev login. The image runs in demo mode so the spec can sign in without
 * an OAuth provider. Every page it visits must raise no policy violation.
 */
const PASSPHRASE = 'PassphraseForImage123!';

async function watchForViolations(page: Page, violations: string[]): Promise<void> {
  await page.exposeFunction('reportCspViolation', (description: string) => {
    violations.push(`${page.url()} -> ${description}`);
  });
  await page.addInitScript(`
    window.addEventListener('securitypolicyviolation', (event) => {
      window.reportCspViolation(
        event.effectiveDirective + ' ' + event.blockedURI + ' (' + event.sourceFile + ':' + event.lineNumber + ')',
      );
    });
  `);
}

async function openWatchedPage(browser: Browser, violations: string[]): Promise<Page> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await watchForViolations(page, violations);
  return page;
}

async function signInToDemo(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /try the demo/i }).click();
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 20000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
  await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
}

test('the production policy is sent, and the demo journey runs without a violation', async ({
  browser,
}) => {
  test.setTimeout(150000);
  const violations: string[] = [];
  const page = await openWatchedPage(browser, violations);

  const login = await page.goto('/login');
  const policy = login?.headers()['content-security-policy'] ?? '';
  expect(policy, 'run this spec against the production image').toContain("default-src 'self'");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  await expect(page.getByRole('button', { name: /try the demo/i })).toBeVisible();

  const showPage = async (path: string, heading: RegExp) => {
    await page.goto(path);
    await expect(page.locator('h1')).toContainText(heading);
  };
  await showPage('/security', /protects your canvases/i);
  await showPage('/privacy', /privacy/i);
  await showPage('/terms', /terms/i);

  // Sign in, create a workspace and a canvas; the demo banner is on every signed-in page.
  await signInToDemo(page);
  await page.fill('#workspace-name', 'Journey Workspace');
  await page.fill('#project-name', 'Journey Project');
  await page.click('button[id="submit-btn"]');
  await expect(page).toHaveURL(/\/w\//, { timeout: 25000 });
  await expect(page.getByRole('status', { name: /demo mode notice/i })).toBeVisible();
  const workspaceUrl = page.url();

  await page.locator('button:has-text("New Canvas")').first().click();
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
  const canvasUrl = page.url();

  // A drawing is saved and comes back after a reload.
  const drawingSaved = page.waitForResponse(
    (res) =>
      res.url().includes('/payload') && res.request().method() === 'PUT' && res.status() === 200,
  );
  await drawRectangle(page);
  await drawingSaved;
  await page.goto(canvasUrl);
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
  await expect.poll(() => sceneElementCount(page), { timeout: 15000 }).toBe(1);

  // An image is encrypted, stored and comes back after a reload.
  const imageUploaded = page.waitForResponse(
    (res) =>
      /\/api\/boards\/[^/]+\/files\//.test(res.url()) &&
      res.request().method() === 'PUT' &&
      res.status() === 200,
  );
  await addImage(page);
  await imageUploaded;
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 20000 });
  await openCanvasShowingImage(page, canvasUrl, 2);

  // A visitor with the public link reads it, with the image.
  await page.locator('button[title="Share Canvas"]').click();
  await page.locator('button[role="switch"]').click();
  await page.getByRole('button', { name: /Copy Public Link/i }).click();
  const publicUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(publicUrl).toContain('#key=');

  const visitor = await openWatchedPage(browser, violations);
  await openCanvasShowingImage(visitor, publicUrl);

  // A second demo visitor has their own account and cannot open the first one's workspace.
  const stranger = await openWatchedPage(browser, violations);
  await signInToDemo(stranger);
  await stranger.goto(workspaceUrl);
  await expect(stranger.getByText('Journey Workspace')).toHaveCount(0);
  const workspaceSlug = new URL(workspaceUrl).pathname.split('/')[2] ?? '';
  const direct = await stranger.context().request.get(`/api/workspaces/${workspaceSlug}`);
  expect([403, 404]).toContain(direct.status());

  expect(violations).toEqual([]);
});
