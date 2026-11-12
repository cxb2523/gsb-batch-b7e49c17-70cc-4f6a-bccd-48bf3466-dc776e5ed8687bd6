/* 降价榜：用自造的本地快照文件（tests/fixtures/snapshots/）替换 data/snapshots 响应，
 * 覆盖正常 diff、缺字段跳过、不足两份、空态与读取失败五种情形。 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { intercept } from "./support.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const snap = n => readFileSync(join(HERE, "fixtures", "snapshots", n), "utf-8");

// sw.js 会接管同源 .json 请求（page.route 拦不到 Service Worker 内的 fetch），本规格禁用 SW
test.use({ serviceWorkers: "block" });

/* index.json 按传入 files 生成；快照文件从 fixtures/snapshots 读，缺失时 404 */
async function mockSnapshots(page, files) {
  await page.route("**/data/snapshots/**", route => {
    const name = route.request().url().split("/").pop();
    if (name === "index.json") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ files }) });
    }
    try {
      return route.fulfill({ contentType: "application/json", body: snap(name) });
    } catch {
      return route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
    }
  });
}

async function openPrice(page) {
  await intercept(page);
  await page.goto("/");
  await page.waitForFunction(() => window.MB && window.MB.D.catalog);
  await page.locator('.section-nav a[href="#sec-tools"]').click();
  await page.locator('#tool-tabs button[data-tool="price"]').click();
  return page.locator("#tool-price");
}

function watchPageErrors(page) {
  const errs = [];
  page.on("pageerror", e => errs.push(e));
  return errs;
}

test("降价榜：正常 diff，0 与负值排除，阈值内不进榜", async ({ page }) => {
  const errs = watchPageErrors(page);
  await mockSnapshots(page, ["2026-11-09.json", "2026-11-10.json"]);
  const pane = await openPrice(page);

  // 对比区间标题显示实际参与对比的两份快照日期
  await expect(pane.locator(".duel-share")).toContainText("2026-11-09");
  await expect(pane.locator(".duel-share")).toContainText("2026-11-10");

  // 降价 Top 10：alpha/one 1 → 0.5 = -50.0%
  await expect(pane.locator(".tool-h").first()).toHaveText("降价 Top 10");
  await expect(pane.locator('tr[data-slug="alpha/one"]')).toContainText("-50.0%");
  // 涨价 Top 5：beta/two 2 → 3 = +50.0%
  await expect(pane.locator('tr[data-slug="beta/two"]')).toContainText("+50.0%");

  // 0 与负值一律排除：delta/four 两期都是 0，epsilon/five 上期是 -1
  await expect(pane.locator('tr[data-slug="delta/four"]')).toHaveCount(0);
  await expect(pane.locator('tr[data-slug="epsilon/five"]')).toHaveCount(0);
  // ±0.1% 阈值内不进榜：gamma/three、zeta/six 两期持平
  await expect(pane.locator('tr[data-slug="gamma/three"]')).toHaveCount(0);
  await expect(pane.locator('tr[data-slug="zeta/six"]')).toHaveCount(0);

  expect(errs).toEqual([]);
});

test("降价榜：最新快照缺 cost 字段时跳过，继续向前找有效快照", async ({ page }) => {
  const errs = watchPageErrors(page);
  // 2026-11-11.json 缺 cost → 跳过，实际对比 11-09 → 11-10
  await mockSnapshots(page, ["2026-11-09.json", "2026-11-10.json", "2026-11-11.json"]);
  const pane = await openPrice(page);

  await expect(pane.locator(".duel-share")).toContainText("2026-11-09");
  await expect(pane.locator(".duel-share")).toContainText("2026-11-10");
  await expect(pane.locator(".duel-share")).not.toContainText("2026-11-11");
  await expect(pane.locator('tr[data-slug="alpha/one"]')).toContainText("-50.0%");
  expect(errs).toEqual([]);
});

test("降价榜：有效快照不足两份时给出明确原因", async ({ page }) => {
  const errs = watchPageErrors(page);
  await mockSnapshots(page, ["2026-11-10.json"]);
  const pane = await openPrice(page);

  await expect(pane.locator(".ph")).toContainText("不足两份");
  await expect(pane.locator(".t-table")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("降价榜：快照文件损坏凑不齐两份时给出明确原因", async ({ page }) => {
  const errs = watchPageErrors(page);
  // 两份里一份缺 cost：跳过后只剩一份有效 → 报文件损坏
  await mockSnapshots(page, ["2026-11-10.json", "2026-11-11.json"]);
  const pane = await openPrice(page);

  await expect(pane.locator(".ph")).toContainText("文件损坏");
  expect(errs).toEqual([]);
});

test("降价榜：快照读取失败时渲染可读提示而非未捕获异常", async ({ page }) => {
  const errs = watchPageErrors(page);
  await page.route("**/data/snapshots/**", route => route.abort());
  const pane = await openPrice(page);

  await expect(pane.locator(".ph")).toContainText("读取失败");
  expect(errs).toEqual([]);
});

test("降价榜：区间内无涨跌时分别显示空态而不是整块消失", async ({ page }) => {
  const errs = watchPageErrors(page);
  // 11-10 与 11-12 成本完全相同 → 全部持平
  await mockSnapshots(page, ["2026-11-10.json", "2026-11-12.json"]);
  const pane = await openPrice(page);

  await expect(pane.locator(".duel-share")).toContainText("2026-11-10");
  await expect(pane.locator(".duel-share")).toContainText("2026-11-12");
  await expect(pane.locator(".tool-h").nth(0)).toHaveText("降价 Top 10");
  await expect(pane.locator(".tool-h").nth(1)).toHaveText("涨价 Top 5");
  await expect(pane).toContainText("区间内无降价记录");
  await expect(pane).toContainText("区间内无涨价记录");
  expect(errs).toEqual([]);
});
