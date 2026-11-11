import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext(mobile ? {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
    } : { viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    const requests = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (/play-info|video\/(public|protected)/.test(url.pathname)) requests.push({ path: url.pathname, status: response.status() });
    });
    await page.goto('https://hongguoduanju.com/player/7695370827507698713/7695386527160863769', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, { timeout: 15000 }).catch(() => {});
    const snapshot = await page.evaluate(() => ({
      media: [...document.querySelectorAll('video')].map(v => ({ duration: Number.isFinite(v.duration) ? v.duration : null,
        readyState: v.readyState, sourcePath: v.currentSrc ? new URL(v.currentSrc).pathname : '', error: v.error?.code ?? null })),
      controls: [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^(?:720|480|360)\s*[pP]$/.test(e.textContent.trim()))
        .map(e => ({ tag: e.tagName, class: e.className, text: e.textContent, parent: e.parentElement.outerHTML.slice(0,1500) })),
      body: document.body.innerText.slice(0,1000),
    }));
    console.log(JSON.stringify({ mobile, ...snapshot, requests }, null, 2));
    await context.close();
  }
} finally { await browser.close(); }
