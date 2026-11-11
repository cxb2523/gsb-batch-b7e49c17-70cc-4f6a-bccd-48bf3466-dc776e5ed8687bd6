import test from 'node:test';
import assert from 'node:assert/strict';

const shareModule = await import('../src/probe/share.mjs').catch(() => ({}));
const httpModule = await import('../src/probe/http.mjs').catch(() => ({}));
const gateModule = await import('../src/probe/gate.mjs').catch(() => ({}));
const webModule = await import('../src/probe/web.mjs').catch(() => ({}));

const fixture = {
  loaderData: {
    'video-animation-share_page': {
      pageData: {
        series_data: { title: '测试漫剧', serial_count: 3, play_url: 'https://cdn.example/video.mp4?token=private', category_list: ['末世'] },
        chapter_ids: ['90071992547409931', '90071992547409932', '90071992547409933'],
        chapter_order: 2,
        used_chapter_id: '90071992547409932',
        recommend_series: [{ series_id: '90071992547409940', series_title: '另一部漫剧', episode_cnt: '6' }],
      },
      linkParams: { schemeParams: { video_id: '90071992547409930' } },
      params: { aid: 8704, chapter_id: '90071992547409932' },
    },
  },
};
const html = `<html><script>window._ROUTER_DATA = ${JSON.stringify(fixture)};</script></html>`;

test('保留大整数剧集编号和相关推荐，同时区分当前集与全集', () => {
  assert.equal(typeof shareModule.parseSharePage, 'function');
  const result = shareModule.parseSharePage(html);
  assert.equal(result.seriesId, '90071992547409930');
  assert.equal(result.episodes[2].id, '90071992547409933');
  assert.equal(result.currentEpisode.order, 2);
  assert.equal(result.recommendations[0].title, '另一部漫剧');
  assert.equal(result.appId, 8704);
});

test('拒绝执行分享页面中的脚本', () => {
  assert.equal(typeof shareModule.parseSharePage, 'function');
  assert.throws(() => shareModule.parseSharePage('<script>window._ROUTER_DATA = (() => { throw "executed"; })();</script>'), /JSON|数据/);
});

test('按剧集构造分享页保留播放标识但去掉分享者身份信息', () => {
  assert.equal(typeof shareModule.buildEpisodePage, 'function');
  const original = new URL('https://hainanyuyue.com/share/video-animation-share?uid=private&did=private&share_type=4');
  const zlink = new URL('https://kylin.hainanyuyue.com/LoRoS');
  zlink.searchParams.set('schemeParams', JSON.stringify({ vid: 'old', video_id: 'series', user_id: 'private', source: '8' }));
  original.searchParams.set('zlink', zlink.toString());
  const rebuilt = new URL(shareModule.buildEpisodePage(original.href, 'new'));
  assert.equal(rebuilt.searchParams.has('uid'), false);
  assert.equal(rebuilt.searchParams.has('did'), false);
  const params = JSON.parse(new URL(rebuilt.searchParams.get('zlink')).searchParams.get('schemeParams'));
  assert.equal(params.vid, 'new');
  assert.equal(params.video_id, 'series');
  assert.equal('user_id' in params, false);
});

test('HTTP 200 空响应应被记录为不可用接口', () => {
  assert.equal(typeof httpModule.inspectJsonResponse, 'function');
  assert.deepEqual(httpModule.inspectJsonResponse(200, ''), { ok: false, status: 200, bytes: 0, reason: 'EMPTY_RESPONSE' });
});

test('HTTP 成功不能覆盖业务错误码', () => {
  assert.equal(typeof httpModule.inspectJsonResponse, 'function');
  const result = httpModule.inspectJsonResponse(200, '{"code":401,"message":"authorization required"}');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'BUSINESS_ERROR');
  assert.equal(result.businessCode, 401);
});

test('网页受保护接口的 base_resp 错误码同样不能忽略', () => {
  const result = httpModule.inspectJsonResponse(200, '{"base_resp":{"StatusCode":403,"StatusMessage":"denied"}}');
  assert.equal(result.ok, false);
  assert.equal(result.businessCode, 403);
});

test('网页内嵌 JSON 后面的其他脚本不应导致解析失败，也不能执行', () => {
  assert.equal(typeof shareModule.parseRouterData, 'function');
  const result = shareModule.parseRouterData('<script>_ROUTER_DATA = {"a":{"text":"}\\\"{"}}; window.unrelated = true;</script>');
  assert.deepEqual(result, { a: { text: '}"{' } });
});

test('受保护网页的公开 SEO 视频必须和完整播放区分', () => {
  assert.equal(typeof shareModule.parseWebPage, 'function');
  const model = { loaderData: { page: { protectedPlayback: true, series_id: '100', vid: '102',
    seriesDetail: { series_id: '100', series_name: '测试作品', episode_cnt: 2, accessible_episode_cnt: 1, vid_list: ['101', '102'] },
    publicVideoSeo: { available: true, itemId: '102', seriesId: '100', durationSeconds: 60 }, videoList: [] } } };
  const result = shareModule.parseWebPage(`<script>_ROUTER_DATA = ${JSON.stringify(model)}; other();</script>`);
  assert.equal(result.protectedPlayback, true);
  assert.equal(result.publicVideo.duration, 60);
  assert.equal(result.publicVideo.fullDurationVerified, false);
  assert.equal(result.episodes[1].id, '102');
  assert.equal(result.accessibleEpisodeCount, 1);
});

test('搜索联想字段没有 video_data 时仍保留真实的作品编号', () => {
  assert.equal(typeof webModule.parseSearchSuggestions, 'function');
  const result = webModule.parseSearchSuggestions({ suggest_list: [
    { name: '测试作品', keyword: '90071992547409940', video_data: {}, word_type: 'short_play_name' },
    { name: '只是关键词', keyword: '动画', video_data: {} },
  ] });
  assert.deepEqual(result, [{ id: '90071992547409940', title: '测试作品', total: 0 }]);
});

test('HTML 搜索页的作品列表可独立核对站内搜索结果', () => {
  assert.equal(typeof webModule.parseWebSearch, 'function');
  const model = { loaderData: { page: { isSuccess: true, totalCount: '10', accessibleEpisodeCnt: 3,
    searchList: [{ name: '测试作品', keyword: '100', video_data: { series_id: '100', episode_cnt: 155 } }] } } };
  const result = webModule.parseWebSearch(`<script>_ROUTER_DATA = ${JSON.stringify(model)};</script>`);
  assert.equal(result.items[0].total, 155);
  assert.equal(result.accessibleEpisodeCount, 3);
});

test('搜索结果优先保留字符串编号，丢弃没有精确替代值的不安全整数', () => {
  const result = webModule.parseSearchSuggestions({ suggest_list: [
    { name: '精确作品', keyword: '7695370827507698713', video_data: { series_id: Number('7695370827507698713') } },
    { name: '精度丢失', keyword: '关键词', video_data: { series_id: Number('7695370827507698713') } },
  ] });
  assert.deepEqual(result, [{ id: '7695370827507698713', title: '精确作品', total: 0 }]);
});

test('规范化的 seriesId 可用来区分两部作品', () => {
  const evidence = {
    series: ['first', 'second'].map(seriesId => ({ seriesId, shareVerified: true, episodeListVerified: true,
      episodes: Array.from({ length: 3 }, (_, index) => ({ id: `${seriesId}-${index}`, order: index + 1, fullDurationVerified: true, duration: 180, expectedDuration: 180, ended: true, seekVerified: true })),
      sequentialPlaybackVerified: true, sequentialEpisodeIds: [0,1,2].map(index => `${seriesId}-${index}`) })), searchVerified: true, recommendationsVerified: true,
  };
  assert.equal(gateModule.evaluateGate(evidence).passed, true);
});

test('公开可访问集数少于全集时，即使样本播放成功也不通过完整追剧验收', () => {
  const evidence = {
    series: ['first','second'].map(seriesId => ({ seriesId, total: 155, accessibleEpisodeCount: 3,
      shareVerified: true, episodeListVerified: true, sequentialPlaybackVerified: true,
      episodes: Array.from({ length: 3 }, (_, index) => ({ id: `${seriesId}-${index}`, order: index + 1, fullDurationVerified: true, duration: 180, expectedDuration: 180, ended: true, seekVerified: true })) })),
    searchVerified: true, recommendationsVerified: true,
  };
  assert.equal(gateModule.evaluateGate(evidence).passed, false);
  assert.ok(gateModule.evaluateGate(evidence).reasons.some(reason => reason.includes('可访问')));
});

test('HTTP 200 非空 JSON 也不能证明返回了完整媒体', () => {
  assert.equal(typeof httpModule.inspectJsonResponse, 'function');
  const result = httpModule.inspectJsonResponse(200, '{"code":0,"data":{}}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { code: 0, data: {} });
});

test('大于 30 秒的视频但缺少完整时长依据时，验收仍不通过', () => {
  assert.equal(typeof gateModule.evaluateGate, 'function');
  const result = gateModule.evaluateGate({ series: [{ episodes: [{ duration: 180, ended: true }] }], searchVerified: true, recommendationsVerified: true });
  assert.equal(result.passed, false);
  assert.ok(result.reasons.length > 0);
});

test('完整观看验收还要求两部剧、搜索、推荐和连续播放证据', () => {
  assert.equal(typeof gateModule.evaluateGate, 'function');
  const evidence = {
    series: ['first', 'second'].map(id => ({ id, shareVerified: true, episodeListVerified: true,
      episodes: Array.from({ length: 3 }, (_, index) => ({ id: `${id}-${index}`, order: index + 1, fullDurationVerified: true, duration: 180, expectedDuration: 180, ended: true, seekVerified: true })),
      sequentialPlaybackVerified: true, sequentialEpisodeIds: [0,1,2].map(index => `${id}-${index}`) })), searchVerified: true, recommendationsVerified: true,
  };
  assert.equal(gateModule.evaluateGate(evidence).passed, true);
  evidence.series[1].episodes[1].ended = false;
  assert.equal(gateModule.evaluateGate(evidence).passed, false);
});

function playbackEvidence() {
  return { searchVerified: true, recommendationsVerified: true,
    series: ['first', 'second'].map(seriesId => ({ seriesId, shareVerified: true, episodeListVerified: true,
      sequentialPlaybackVerified: true, sequentialEpisodeIds: ['1', '2', '3'],
      episodes: [1, 2, 3].map(order => ({ id: String(order), order, fullDurationVerified: true,
        duration: 180, expectedDuration: 180, ended: true, seekVerified: true })) })) };
}

test('重复同一集三次不能满足三个不同分集的验收', () => {
  const evidence = playbackEvidence();
  evidence.series[0].episodes = Array(3).fill(evidence.series[0].episodes[0]);
  assert.equal(gateModule.evaluateGate(evidence).passed, false);
});

test('没有分集 ID 和顺序的播放记录不能用于验收', () => {
  const evidence = playbackEvidence();
  evidence.series[0].episodes.forEach(episode => { delete episode.id; delete episode.order; });
  assert.equal(gateModule.evaluateGate(evidence).passed, false);
});

test('连续播放必须有至少三个按相邻集序播放的记录', () => {
  const evidence = playbackEvidence();
  evidence.series[0].sequentialEpisodeIds = ['1', '3', '2'];
  assert.equal(gateModule.evaluateGate(evidence).passed, false);
});
