import { expect, test } from '@playwright/test';

const streamUrls = [
  'https://184.194.94.182/camera01/',
  'https://184.194.94.182/camera03/'
];

async function ensureTestCameras(request) {
  const inventoryResponse = await request.get('/api/camera');
  expect(inventoryResponse.ok()).toBeTruthy();
  const inventory = await inventoryResponse.json();
  const registeredPaths = new Set(
    (inventory.cameras ?? []).map((camera) => camera.streamPath)
  );

  for (const streamUrl of streamUrls) {
    const streamPath = new URL(streamUrl).pathname.split('/').filter(Boolean).at(-1);
    if (registeredPaths.has(streamPath)) continue;

    const registration = await request.post('/api/camera', {
      data: { name: `Cámara ${streamPath}`, url: streamUrl }
    });
    expect(registration.status()).toBe(201);
    registeredPaths.add(streamPath);
  }

  const updatedResponse = await request.get('/api/camera');
  expect(updatedResponse.ok()).toBeTruthy();
  return (await updatedResponse.json()).cameras ?? [];
}

test('flujo integrado de SentriX con FastAPI y las dos transmisiones', async ({ page, request, browser }) => {
  test.slow();

  await test.step('comprobar que FastAPI está disponible mediante el frontend', async () => {
    const response = await request.get('/api/inference');
    expect(response.ok()).toBeTruthy();
    const snapshot = await response.json();
    expect(snapshot.available).toBe(true);
    expect(snapshot.health?.status).toBe('ok');
    expect(snapshot.health?.model_loaded).toBe(true);
  });

  await test.step('comprobar la disponibilidad directa de camera01 y camera03', async () => {
    for (const streamUrl of streamUrls) {
      const response = await request.get(streamUrl, { ignoreHTTPSErrors: true });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type'] ?? '').toContain('text/html');
    }
  });

  await test.step('registrar las dos cámaras cuando no existan', async () => {
    const cameras = await ensureTestCameras(request);
    expect(cameras.some((camera) => camera.streamPath === 'camera01')).toBe(true);
    expect(cameras.some((camera) => camera.streamPath === 'camera03')).toBe(true);
  });

  await test.step('visualizar el resumen general', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Resumen general' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
    await page.waitForTimeout(2_000);
  });

  await test.step('recorrer el monitoreo en vivo', async () => {
    await page.locator('nav button').nth(1).click();
    await expect(page.getByRole('heading', { name: 'Monitoreo en vivo' })).toBeVisible();
    await page.waitForTimeout(2_000);
  });

  await test.step('mostrar las dos cámaras en el inventario', async () => {
    await page.locator('nav button').nth(2).click();
    await expect(page.getByRole('heading', { name: 'Cámaras', exact: true })).toBeVisible();
    await expect(page.getByText('Cámara camera01', { exact: true })).toBeVisible();
    await expect(page.getByText('Cámara camera03', { exact: true })).toBeVisible();
    await page.waitForTimeout(2_000);
  });

  await test.step('consultar detecciones y paginar cuando exista más de una página', async () => {
    await page.locator('nav button').nth(3).click();
    await expect(page.getByRole('heading', { name: 'Detecciones', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Historial de detecciones' })).toBeVisible();
    await expect(page.getByText(/\d+ resultados/)).toBeVisible();
    const nextButton = page.getByRole('button', { name: 'Siguiente →' });
    await page.waitForTimeout(2_000);

    if ((await nextButton.count()) > 0 && (await nextButton.isEnabled())) {
      await nextButton.click();
      await expect(page.getByText(/Página 2 de/)).toBeVisible();
    } else {
      await expect(
        page.getByText(/Sin registros disponibles|Mostrando 1–\d+ de \d+ detecciones/)
      ).toBeVisible();
    }
  });

  await test.step('consultar los registros técnicos', async () => {
    await page.locator('nav button').nth(5).click();
    await expect(page.getByRole('heading', { name: 'Registros del servicio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Historial técnico de inferencia' })).toBeVisible();
    await expect(page.getByText('Tiempo promedio')).toBeVisible();
    await page.waitForTimeout(2_000);
  });

  await browser.close();
});
