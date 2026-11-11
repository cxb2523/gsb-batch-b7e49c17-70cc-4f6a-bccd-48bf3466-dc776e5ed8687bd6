import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

export async function openProbeBrowser() {
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel, headless: true }); } catch {}
  }
  if (process.env.HONGGUO_BROWSER_PATH) {
    await access(process.env.HONGGUO_BROWSER_PATH);
    return chromium.launch({ executablePath: process.env.HONGGUO_BROWSER_PATH, headless: true });
  }
  throw new Error('未找到 Chrome/Edge；可通过 HONGGUO_BROWSER_PATH 指定浏览器程序');
}

export async function inspectMedia(browser, url, { watch = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // 隔离的测试页只加载浏览器可正常播放的公开媒体，不导出或解密受保护视频。
    await page.setContent('<video preload="metadata"></video>');
    return await page.evaluate(async ({ url, watch }) => {
      const video = document.querySelector('video');
      const metadata = await new Promise(resolve => {
        const timer = setTimeout(() => resolve({ ok: false, reason: 'METADATA_TIMEOUT' }), 20000);
        video.onloadedmetadata = () => { clearTimeout(timer); resolve({ ok: true, duration: video.duration, width: video.videoWidth, height: video.videoHeight }); };
        video.onerror = () => { clearTimeout(timer); resolve({ ok: false, reason: 'MEDIA_ERROR', mediaError: video.error?.code }); };
        video.src = url;
      });
      if (!metadata.ok || !watch) return metadata;
      video.muted = true;
      let ended = false;
      video.addEventListener('ended', () => { ended = true; });
      try {
        await video.play();
        await new Promise(resolve => setTimeout(resolve, 1000));
        const playingVerified = video.currentTime > 0 && !video.paused;
        const target = video.duration / 2;
        const seekVerified = await new Promise(resolve => {
          const timer = setTimeout(() => resolve(false), 10000);
          video.addEventListener('seeked', () => { clearTimeout(timer); resolve(Math.abs(video.currentTime - target) < 1); }, { once: true });
          video.currentTime = target;
        });
        // 从中点正常播放到结尾，验证播放管线；不是整集完整观看验收。
        await new Promise(resolve => {
          if (ended) return resolve();
          const timer = setTimeout(resolve, Math.min(video.duration * 1000 + 10000, 70000));
          video.addEventListener('ended', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        return { ...metadata, playingVerified, seekVerified, ended,
          audioDecodedBytes: video.webkitAudioDecodedByteCount || 0, soundAuditionVerified: false,
          fullDurationVerified: false, observation: '公开媒体管线验证，不是完整正片验收' };
      } catch (error) { return { ...metadata, playingVerified: false, reason: 'PLAY_FAILED', error: error.message }; }
    }, { url, watch });
  } finally { await context.close(); }
}

export async function inspectSitePlayer(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (/play-info|video\/(public|protected)/.test(url.pathname)) requests.push({ path: url.pathname, status: response.status() });
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20000 }).catch(() => {});
    const state = await page.evaluate(() => ({
      media: [...document.querySelectorAll('video')].map(video => ({ duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState, sourcePath: video.currentSrc ? new URL(video.currentSrc).pathname : '', error: video.error?.code ?? null })),
      qualityControls: [...document.querySelectorAll('[aria-disabled]')].filter(e => /(?:360|480|720)P/.test(e.innerText))
        .map(e => ({ text: e.innerText, disabled: e.getAttribute('aria-disabled') === 'true' })),
      directsToApp: /App.{0,12}全集|客户端.{0,12}全集/.test(document.body.innerText),
    }));
    return { ...state, requests, fullPlaybackVerified: false };
  } finally { await context.close(); }
}
