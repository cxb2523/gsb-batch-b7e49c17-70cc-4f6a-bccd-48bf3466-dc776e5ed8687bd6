import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSharePage, buildEpisodePage, publicSeriesSummary } from '../src/probe/share.mjs';
import { requestText } from '../src/probe/http.mjs';
import { evaluateGate } from '../src/probe/gate.mjs';
import { loadReferenceConfig, probeNativeApi } from '../src/probe/native-api.mjs';
import { getWebSeries, searchWeb, probeProtectedMedia, getHotList, WEB_ORIGIN } from '../src/probe/web.mjs';
import { openProbeBrowser, inspectMedia, inspectSitePlayer } from '../src/probe/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shareIndex = args.indexOf('--share');
const shareUrl = shareIndex >= 0 ? args[shareIndex + 1] : 'https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/';
const skipBrowser = args.includes('--skip-browser');
const report = { generatedAt: new Date().toISOString(), timeZone: 'Asia/Shanghai', stage2Started: false,
  acceptedGoal: 'Windows 独立客户端：完整追剧、搜索、分享导入、热门及相关推荐',
  sourceCaveat: '候选网页源的运营方身份尚未独立核实；其“官网”文案不作为官方授权依据。',
  nativeProbeCaveat: '8704 测试仅替换参考参数中的 aid；不是经过官方验证的漫剧协议适配。',
  series: [], nativeApi: [], search: [], browser: [], errors: [] };

async function capture(label, task) {
  try { return await task(); }
  catch (error) { report.errors.push({ label, error: error.message }); console.log(`${label}：${error.message}`); return null; }
}
function publicMediaUrl(episodeId) { return `${WEB_ORIGIN}/video/public/${encodeURIComponent(episodeId)}/360p.mp4`; }
function sampleEpisodes(series) {
  return [...new Set([0, 1, 2, Math.floor(series.episodes.length / 2), series.episodes.length - 1])]
    .filter(index => index >= 0).map(index => series.episodes[index]);
}
function secondShareUrl(base, seriesId, episodeId) {
  const url = new URL(buildEpisodePage(base, episodeId));
  const zlink = new URL(url.searchParams.get('zlink'));
  const params = JSON.parse(zlink.searchParams.get('schemeParams'));
  params.video_id = seriesId;
  params.share_toast_vid = episodeId;
  zlink.searchParams.set('schemeParams', JSON.stringify(params));
  url.searchParams.set('zlink', zlink.href);
  return url.href;
}

let browser;
try {
  console.log('1/5：解析用户分享页');
  const original = await requestText(shareUrl);
  if (original.status !== 200) throw new Error(`分享页 HTTP ${original.status}`);
  const first = parseSharePage(original.text);
  const expectedEpisodeCount = shareIndex < 0 ? 155 : undefined;
  const firstWeb = await capture('第一部作品网页列表', () => getWebSeries(first.seriesId));
  report.series.push({ ...publicSeriesSummary(first), expectedEpisodeCount, shareVerified: true,
    accessibleEpisodeCount: firstWeb?.accessibleEpisodeCount ?? null,
    web: firstWeb, episodeListVerified: Boolean(firstWeb && firstWeb.title === first.title &&
      firstWeb.episodes.length === first.episodes.length && firstWeb.episodes.every((item,index) => item.id === first.episodes[index].id)),
    episodes: [], sequentialPlaybackVerified: false });

  console.log('2/5：核对第二部漫剧、搜索和推荐');
  const candidate = first.recommendations.find(item => item.id && item.id !== first.seriesId && item.total >= 3);
  let second;
  let secondUrl;
  if (candidate) {
    const web = await capture('第二部作品网页列表', () => getWebSeries(candidate.id));
    if (web) {
      secondUrl = secondShareUrl(original.url, candidate.id, web.episodes[0].id);
      const shared = await capture('第二部作品分享页', async () => parseSharePage((await requestText(secondUrl)).text));
      second = shared || { ...web, currentEpisode: { id: web.episodes[0].id, order: 1, url: '' }, recommendations: [], categories: [] };
      report.series.push({ ...publicSeriesSummary(second), web,
        accessibleEpisodeCount: web.accessibleEpisodeCount,
        shareVerified: Boolean(shared && shared.seriesId === candidate.id && shared.title === candidate.title),
        episodeListVerified: Boolean(shared && shared.episodes.length === web.episodes.length &&
          web.episodes.every((item,index) => item.id === shared.episodes[index].id)),
        episodes: [], sequentialPlaybackVerified: false });
    }
  }
  for (const series of [first, second].filter(Boolean)) {
    const result = await capture(`搜索《${series.title}》`, () => searchWeb(series.title));
    report.search.push({ query: series.title, ...(result || {}), targetMatched: Boolean(result?.items.some(item => item.id === series.seriesId && item.title === series.title)) });
  }
  report.hotList = await capture('热门列表', getHotList);
  report.recommendations = { origin: '用户分享页推荐列表', count: first.recommendations.length,
    metadataVerified: Boolean(second), fullPlaybackVerified: false };

  console.log('3/5：抽查原生详情与播放接口（不执行上游源码）');
  const config = await capture('读取已审查的请求常量', () => loadReferenceConfig(path.join(root, 'research/upstream/native-api.js.txt')));
  if (config) {
    const jobs = [first, second].filter(Boolean).flatMap(series => ['8662','8704'].flatMap(aid => ['detail','model'].map(type => ({ series, aid, type }))));
    const results = await Promise.allSettled(jobs.map(async job => probeNativeApi(config, job.series, job.aid, job.type)));
    results.forEach((result,index) => report.nativeApi.push(result.status === 'fulfilled' ? result.value : {
      seriesId: jobs[index].series.seriesId, aid: jobs[index].aid, type: jobs[index].type, ok: false, reason: result.reason.message,
    }));
  }

  console.log('4/5：核对公开媒体和受保护媒体，进行隔离浏览器验证');
  if (!skipBrowser) browser = await capture('打开隔离验证浏览器', openProbeBrowser);
  for (const [index, series] of [first, second].filter(Boolean).entries()) {
    const samples = sampleEpisodes(series);
    const probes = await Promise.allSettled(samples.map(async episode => {
      const [webResult, protectedResult] = await Promise.allSettled([
        getWebSeries(series.seriesId, episode.id), probeProtectedMedia(series.seriesId, episode.id),
      ]);
      return { id: episode.id, order: episode.order,
        publicVideo: webResult.status === 'fulfilled' ? webResult.value.publicVideo : null,
        webError: webResult.status === 'rejected' ? webResult.reason.message : null,
        protectedMedia: protectedResult.status === 'fulfilled' ? protectedResult.value : null,
        protectedError: protectedResult.status === 'rejected' ? protectedResult.reason.message : null,
        fullDurationVerified: false, expectedDuration: null, duration: null, ended: false, seekVerified: false };
    }));
    report.series[index].episodes = probes.map((result, sampleIndex) => result.status === 'fulfilled' ? result.value : {
      id: samples[sampleIndex].id, order: samples[sampleIndex].order, error: result.reason.message,
      fullDurationVerified: false, ended: false, seekVerified: false,
    });
    if (browser) {
      for (const episode of report.series[index].episodes.filter(item => item.publicVideo)) {
        const observation = await capture(`作品 ${index + 1} 第 ${episode.order} 集公开媒体时长`, () => inspectMedia(browser, publicMediaUrl(episode.id)));
        episode.publicObservation = observation;
        episode.duration = observation?.duration || null;
      }
      const player = await capture(`作品 ${index + 1} 浏览器默认播放器`, () => inspectSitePlayer(browser, `${WEB_ORIGIN}/player/${series.seriesId}/${series.episodes[0].id}`));
      report.browser.push({ seriesId: series.seriesId, player });
    }
  }
  if (browser) {
    const originalSample = await capture('分享视频实际播放', () => inspectMedia(browser, first.currentEpisode.url, { watch: true }));
    report.shareMediaObservation = originalSample;
    for (const episode of [first.episodes[0], first.episodes.at(-1)]) {
      const response = await capture(`分享页第 ${episode.order} 集`, () => requestText(buildEpisodePage(original.url, episode.id)));
      if (response) {
        const data = await capture(`分享页第 ${episode.order} 集解析`, async () => parseSharePage(response.text));
        if (data) report.browser.push({ source: '分享页', order: episode.order, matchedRequestedEpisode: data.currentEpisode.id === episode.id,
          media: await capture(`分享页第 ${episode.order} 集媒体`, () => inspectMedia(browser, data.currentEpisode.url)) });
      }
    }
  }
  report.searchVerified = report.search.length === 2 && report.search.every(item => item.pageOk && item.targetMatched);
  report.recommendationsVerified = false; // 取得推荐元数据不等于推荐作品完整可播。
} catch (error) { report.errors.push({ label: '验证流程', error: error.message }); }
finally { if (browser) await browser.close(); }

console.log('5/5：输出验收结论和证据');
report.gate = evaluateGate(report);
if (report.errors.length) report.gate.reasons.push(...report.errors.map(item => `${item.label}：${item.error}`));
report.gate.passed = report.gate.passed && report.errors.length === 0;
await mkdir(path.join(root, 'research'), { recursive: true });
await writeFile(path.join(root, 'research/latest-result.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
const rows = report.series.map(series => `| ${series.title} | ${series.total} | ${series.accessibleEpisodeCount ?? '未知'} | ${series.shareVerified ? '正确' : '未通过'} | ${series.episodeListVerified ? '一致' : '未通过'} | ${series.episodes.map(e => `第${e.order}集：公开 ${e.publicObservation?.duration ?? e.publicVideo?.duration ?? '未知'} 秒 / 受保护接口 ${e.protectedMedia?.duration ?? '未知'} 秒${e.webError ? '；网页：' + e.webError : ''}${e.protectedError ? '；播放接口：' + e.protectedError : ''}${e.protectedMedia?.ok === false ? '；播放接口：HTTP ' + e.protectedMedia.status + ' ' + e.protectedMedia.reason : ''}`).join('；')} |`);
const apiRows = report.nativeApi.map(item => `| ${item.seriesId} | ${item.aid} | ${item.type} | ${item.status ?? '网络错误'} | ${item.bytes ?? '-'} | ${item.reason || '返回 JSON（仍需完整播放验收）'} |`);
const protectedCount = report.series.flatMap(series => series.episodes).filter(episode =>
  episode.protectedMedia?.ok === true && episode.protectedMedia.format === 'dash' && episode.protectedMedia.requiresProtectedPlayer).length;
const text = `# 内容接入验证报告\n\n验证时间：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full', timeStyle: 'long' }).format(new Date(report.generatedAt))}。\n\n**前置验收：${report.gate.passed ? '通过' : '未通过'}。正式桌面界面和安装包尚未开发。**\n\n## 实测结果\n\n| 作品 | 全集数 | 网页声明可访问集数 | 分享识别 | 分集顺序与分享页核对 | 抽查媒体时长 |\n|---|---:|---:|---|---|---|\n${rows.join('\n')}\n\n搜索：${report.search.map(item => `《${item.query}》${item.targetMatched ? '匹配正确作品' : '未验证成功'}`).join('；') || '未验证'}。\n\n分享页推荐：${report.recommendations?.count ?? 0} 个；网页热门接口：${report.hotList?.ok ? `${report.hotList.count} 个（榜单性质待核实）` : `未取得，HTTP ${report.hotList?.status ?? '未知'} ${report.hotList?.reason ?? '请求失败或未执行'}`}。推荐数据可取得不等于推荐作品完整播放通过。\n\n原始分享视频：${report.shareMediaObservation?.duration ?? '未验证'} 秒；起播 ${Boolean(report.shareMediaObservation?.playingVerified)}，跳转 ${Boolean(report.shareMediaObservation?.seekVerified)}，播放至片段结尾 ${Boolean(report.shareMediaObservation?.ended)}。这仅证明公开片段的播放管线可用。\n\n## 原生接口响应\n\n| 作品 ID | aid | 请求 | HTTP | 响应字节 | 结果 |\n|---|---|---|---|---:|---|\n${apiRows.join('\n')}\n\n${report.nativeProbeCaveat}\n\n## 完整播放限制\n\n本次取得 ${protectedCount} 个需要受保护播放器的 DASH 响应。浏览器默认播放器的实际媒体路径和状态记录于 JSON 的 browser 字段。公开 SEO 视频未标记为完整正片，实际可访问集数和中间集、末集响应另行记录。完整时长需要可核对依据，不能只凭 30 秒、60 秒或接口中的单个 duration 字段推断。\n\n访问密钥、kid、签名 URL 不进入报告；普通 MP4 播放器不能自动处理这些音视频分离的受保护 DASH 响应。\n\n${report.sourceCaveat}\n\n## 未通过项\n\n${report.gate.reasons.map(reason => '- ' + reason).join('\n') || '无'}\n\n## 后续可行路线\n\n1. 取得覆盖全集的正常播放入口，再核实网页播放器可嵌入条件；验证通过后才恢复桌面开发。\n2. 获取平台提供的桌面内容接口或播放器接入方案，然后重跑这套验收。\n3. 如果以后接受手机连接或 Android 运行环境，可以另行改用原版 APP；当前没有自动采用该路线。\n\n## 重跑\n\n在项目目录执行 npm ci、npm test、npm run probe。验证报告更新于 research/REPORT.md 和 research/latest-result.json。前置验收未通过时命令退出码为 2，不会把程序测试通过当作内容验收通过。\n`;
await writeFile(path.join(root, 'research/REPORT.md'), text, 'utf8');
console.log(JSON.stringify({ gatePassed: report.gate.passed, series: report.series.length, nativeResults: report.nativeApi.length,
  errors: report.errors.length, report: path.join(root, 'research/REPORT.md') }, null, 2));
process.exitCode = report.gate.passed ? 0 : 2;
