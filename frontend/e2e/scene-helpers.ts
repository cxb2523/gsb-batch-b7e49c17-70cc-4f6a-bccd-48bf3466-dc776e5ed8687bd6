import { expect, type Page } from '@playwright/test';

/**
 * Drives the Excalidraw canvas the way a person does, so the application carries no handle that
 * exists only for tests.
 */

/** A 2x2 PNG, small enough to stay well under the image limits. */
export const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGACU2BAQv5hO7AAAAAElFTkSuQmCC',
  'base64',
);

async function canvasBox(page: Page) {
  const canvas = page.locator('canvas.excalidraw__canvas.interactive').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Excalidraw canvas has no bounding box');
  return box;
}

/**
 * The number of shapes in the scene, read from Excalidraw's own statistics panel (Alt+/), which
 * lists it under "Scene". Returns 0 when the canvas is not mounted (locked or blocked).
 */
export async function sceneElementCount(page: Page): Promise<number> {
  const editor = page.locator('.excalidraw').first();
  if ((await page.locator('canvas.excalidraw__canvas.interactive').count()) === 0) return 0;

  const read = async () =>
    /Scene\s+Shapes\s+(\d+)/.exec((await editor.innerText()).replace(/\s+/g, ' '))?.[1];

  if ((await read()) === undefined) {
    // The shortcut only works while the editor has focus.
    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
    await page.keyboard.press('Alt+Slash');
  }
  // With a canvas on screen the panel must appear; a missing panel is a failure, not "zero shapes".
  await expect
    .poll(read, { message: 'the statistics panel did not open', timeout: 5000 })
    .toBeDefined();
  return Number(await read());
}

/** Draws a rectangle in the middle of the canvas, away from the floating toolbars. */
export async function drawRectangle(page: Page): Promise<void> {
  const box = await canvasBox(page);
  const startX = box.x + box.width * 0.55;
  const startY = box.y + box.height * 0.6;

  await page.locator('button[aria-label="Rectangle"]').click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY + 110, { steps: 20 });
  await page.mouse.up();
}

/**
 * Opens a canvas (or a public link) and waits until the browser has fetched an image file for it
 * and the editor is showing. When `shapes` is given, the scene must also hold that many shapes
 * (the image element among them). This proves the image was fetched and the scene was rebuilt; it
 * does not inspect pixels. (The public view hides the statistics panel, so it passes no count.)
 */
export async function openCanvasShowingImage(
  page: Page,
  url: string,
  shapes?: number,
): Promise<void> {
  const imageFetched = page.waitForResponse(
    (res) =>
      /\/api\/(public\/)?boards\/[^/]+\/files\//.test(res.url()) &&
      res.request().method() === 'GET' &&
      res.status() === 200,
    { timeout: 20000 },
  );
  await page.goto(url);
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20000 });
  await imageFetched;
  if (shapes !== undefined) {
    await expect.poll(() => sceneElementCount(page), { timeout: 15000 }).toBe(shapes);
  }
}

/**
 * Pastes a small image into the canvas, as if it had been copied from somewhere else. (The image
 * tool's own picker uses the browser's file system dialog, which a test cannot drive.)
 */
export async function addImage(page: Page): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, TEST_PNG.toString('base64'));
}
