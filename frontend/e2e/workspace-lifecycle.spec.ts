import { test, expect } from '@playwright/test';
import { createTestUserSession, completePassphrasePage } from './e2ee-test-helpers';

const PASSPHRASE = 'WorkspaceLifecycle123!';

test.describe('CanvHQ E2E: workspace dashboard, rename and deletion', () => {
  test('an owner creates a canvas, finds it again, renames the workspace and deletes it', async ({
    page,
  }) => {
    test.setTimeout(90_000); // passphrase key derivation plus a long single-user journey
    const ts = Date.now();
    const workspaceName = `Acme Systems ${ts}`;
    const projectName = `Cloud Mesh ${ts}`;
    const canvasTitle = 'API Gateway Mesh';

    await createTestUserSession(
      page.request,
      page.context(),
      `lifecycle_${ts}@canvhq.internal`,
      `Engineer ${ts}`,
    );

    // Passphrase first, then onboarding provisions the workspace and its first project.
    await page.goto('/create-workspace');
    await completePassphrasePage(page, PASSPHRASE);
    await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await page.fill('#workspace-name', workspaceName);
    await page.fill('#project-name', projectName);
    await page.click('button[id="submit-btn"]');
    await expect(page).toHaveURL(/\/w\//, { timeout: 20000 });
    await expect(page.locator(`text=${workspaceName}`).first()).toBeVisible();
    await expect(page.locator(`text=${projectName}`).first()).toBeVisible();

    // Create a canvas and rename it in place.
    await page.locator('button:has-text("New Canvas")').first().click();
    await expect(page).toHaveURL(/\/w\/.*\/canvas\//, { timeout: 15000 });
    const header = page.locator('header');
    await header.locator('text=Untitled').click();
    const titleInput = header.locator('input[type="text"]');
    await titleInput.fill(canvasTitle);
    const renamed = page.waitForResponse(
      (res) => res.request().method() === 'PATCH' && res.url().includes('/api/boards/'),
    );
    await titleInput.press('Enter');
    await expect(header.locator(`text=${canvasTitle}`)).toBeVisible();
    expect((await renamed).ok()).toBe(true);

    // Back on the dashboard the canvas is listed and the search palette finds it.
    await header.locator('text=Back').click();
    await expect(page).toHaveURL(/\/w\//, { timeout: 10000 });
    await expect(page.locator(`text=${canvasTitle}`).first()).toBeVisible();

    await page.locator('button[title*="Search"]').click();
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('API Gateway');
    await expect(page.locator(`text=${canvasTitle}`).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();

    // Rename the workspace from the management page.
    await page.click('a:has-text("Management")');
    await expect(page).toHaveURL(/\/w\/.*\/management/, { timeout: 10000 });
    await page.getByTitle('Rename workspace').click();
    await page.fill('#workspace-name-input', `${workspaceName} Updated`);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('text=Workspace updated successfully!')).toBeVisible();

    // Deleting needs the exact (new) workspace name typed back.
    await page.getByRole('button', { name: 'Delete Workspace', exact: true }).click();
    const confirmDelete = page.getByRole('button', { name: 'Permanently Delete Workspace' });
    await expect(confirmDelete).toBeDisabled();
    await page.fill('#confirm-delete-input', 'Incorrect Name');
    await expect(confirmDelete).toBeDisabled();
    await page.fill('#confirm-delete-input', `${workspaceName} Updated`);
    await expect(confirmDelete).toBeEnabled();
    await confirmDelete.click();

    // The sole workspace is gone, so the user is sent to create a new one.
    await expect(page).toHaveURL(/\/create-workspace/, { timeout: 15000 });
  });
});
