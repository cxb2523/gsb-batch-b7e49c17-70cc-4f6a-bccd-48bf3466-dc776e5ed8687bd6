import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Isolate layout checks from network availability. Full playback is checked separately.
const output = path.resolve('outputs/bc-ui');
await mkdir(output, { recursive: true });
const report = { generatedAt: new Date().toISOString(), passed: false, checks: [], errors: [] };
const fixtureWorks = Array.from({ length: 12 }, (_, index) => ({
  id: `ui-${index}`, title: index === 0 ? '很长的真实作品标题也应当完整显示并保持按钮可用' : `示例作品${index + 1}`,
  cover: '', description: '用于检查桌面布局的占位数据，不是线上推荐内容。', total: 155, categories: ['科幻', '冒险'],
}));
const history = fixtureWorks.slice(3, 6).map((work, index) => ({ work, seriesId: work.id, episodeId: `ep-${index}`, order: index + 3, time: 12, duration: 60, updatedAt: Date.now() - index }));
let app, page;
try {
  app = await electron.launch({ args: ['.'], env: { ...process.env, HONGGUO_TEST_DATA: path.join(output, `fixture-profile-${Date.now()}`) } });
  page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await app.evaluate(({ ipcMain }, { works, history }) => {
    const ok = data => ({ ok: true, data });
    let favorites = [];
    const library = () => ({ favorites, history });
    const handlers = {
      catalog: board => ok({ items: works, hasMore: false, nextOffset: 0, label: { recommend: '推荐榜', hot: '热播榜', new: '新剧榜' }[board], source: 'UI fixture' }),
      search: () => ok({ items: works.slice(0, 1), hasMore: false, nextOffset: 0, label: '搜索结果', source: 'UI fixture' }),
      library: () => ok(library()),
      favorite: (work, enabled) => { favorites = enabled ? [...favorites, work] : favorites.filter(item => item.id !== work.id); return ok(library()); },
      series: id => ok({ ...works.find(work => work.id === id), episodes: [] }),
      update: () => ok({ message: '布局检查版本' }),
    };
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, ...args) => handler(...args));
    }
  }, { works: fixtureWorks, history });
  await page.reload();
  await page.waitForSelector('.work-card');
  assert.equal(await page.locator('.sidebar').count(), 0, 'Approved layout removes the wide sidebar');
  await page.getByRole('tab', { name: '推荐榜', exact: true }).waitFor();
  assert.equal(await page.locator('.resume-card').count(), 3, 'Homepage shows three actual history entries');
  const firstTitle = await page.locator('.spotlight h2').innerText();
  await page.getByRole('button', { name: '切换推荐作品2', exact: true }).click();
  assert.notEqual(await page.locator('.spotlight h2').innerText(), firstTitle);
  await page.getByRole('button', { name: '立即观看', exact: true }).click();
  assert.equal(await page.locator('.detail-heading h1').innerText(), fixtureWorks[1].title);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.locator('.resume-card').first().click();
  assert.equal(await page.locator('.detail-heading h1').innerText(), history[0].work.title);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '切换推荐作品1', exact: true }).click();
  for (const [width, height] of [[1040, 720], [1400, 920], [1536, 1024]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await page.waitForTimeout(200);
    const geometry = await page.evaluate(() => {
      const main = document.querySelector('.content-scroll');
      const buttons = [...document.querySelectorAll('.topbar button, .spotlight-actions button')].map(button => {
        const bounds = button.getBoundingClientRect();
        return { label: button.getAttribute('aria-label') || button.textContent, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      });
      return { width: innerWidth, height: innerHeight, bodyOverflow: document.body.scrollWidth > innerWidth, mainOverflow: main.scrollWidth > main.clientWidth, background: getComputedStyle(document.documentElement).backgroundColor, buttons };
    });
    assert.equal(geometry.bodyOverflow, false);
    assert.equal(geometry.mainOverflow, false);
    assert.equal(geometry.background, 'rgb(244, 240, 232)');
    for (const button of geometry.buttons) assert.ok(button.left >= 0 && button.right <= geometry.width && button.bottom <= geometry.height, `${button.label} must fit the window`);
    await page.screenshot({ path: path.join(output, `layout-${width}.png`) });
    report.checks.push({ step: 'window-layout', ...geometry });
  }
  await page.getByRole('button', { name: '导入分享', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({ path: path.join(output, 'import-dialog.png') });
  await page.getByRole('textbox', { name: '分享文本或链接' }).press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(report.errors, []);
  report.checks.push({ step: 'hero-navigation-resume-dialog', passed: true });
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await writeFile(path.join(output, 'layout-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
