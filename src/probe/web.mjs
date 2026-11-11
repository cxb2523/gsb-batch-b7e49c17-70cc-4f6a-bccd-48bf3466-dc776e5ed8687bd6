import { inspectJsonResponse, requestText } from './http.mjs';
import { parseWebPage, parseRouterData } from './share.mjs';

export const WEB_ORIGIN = 'https://hongguoduanju.com';

export function parseSearchSuggestions(data) {
  return (data.suggest_list || []).flatMap(item => {
    const value = item.video_data || {};
    const candidates = [value.series_id, item.keyword];
    const exact = candidates.find(id => typeof id === 'string' && /^[1-9]\d*$/.test(id));
    const numeric = candidates.find(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
    const id = String(exact ?? numeric ?? '');
    if (!/^[1-9]\d*$/.test(id)) return [];
    return [{ id, title: item.name || value.series_name || value.series_title || '', total: Number(value.episode_cnt) || 0 }];
  });
}

export function parseWebSearch(html) {
  const data = Object.values(parseRouterData(html).loaderData || {}).find(value => Array.isArray(value?.searchList));
  if (!data) throw new Error('搜索页面没有可核对的作品列表');
  return { ok: data.isSuccess === true, items: parseSearchSuggestions({ suggest_list: data.searchList }),
    accessibleEpisodeCount: data.accessibleEpisodeCnt ?? null, totalCount: Number(data.totalCount) || 0 };
}

export async function getWebSeries(seriesId, episodeId = '') {
  const url = `${WEB_ORIGIN}/player/${encodeURIComponent(seriesId)}${episodeId ? '/' + encodeURIComponent(episodeId) : ''}`;
  const response = await requestText(url);
  if (response.status !== 200) throw new Error(`网页返回 HTTP ${response.status}`);
  return parseWebPage(response.text);
}

export async function searchWeb(query) {
  const url = new URL('/incent_resource/suggestion', WEB_ORIGIN);
  url.searchParams.set('query', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('app_id', '8662');
  url.searchParams.set('web_id', String(Date.now()));
  const response = await requestText(url, { headers: { Accept: 'application/json' } });
  const result = inspectJsonResponse(response.status, response.text);
  const items = parseSearchSuggestions(result.data || {});
  const { data, ...summary } = result;
  const html = await requestText(`${WEB_ORIGIN}/search/${encodeURIComponent(query)}`);
  const page = parseWebSearch(html.text);
  return { ...summary, items: page.items, suggestionItems: items, source: '网页搜索页',
    pageOk: page.ok, accessibleEpisodeCount: page.accessibleEpisodeCount, totalCount: page.totalCount };
}

export async function probeProtectedMedia(seriesId, episodeId) {
  const response = await requestText(`${WEB_ORIGIN}/api/video/protected/play-info`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ series_id: seriesId, item_id: episodeId, definition: '720p' }) });
  const result = inspectJsonResponse(response.status, response.text);
  const info = result.data?.play_info;
  const legacy = result.data?.legacy_play_info;
  const { data, ...summary } = result;
  return { ...summary, hasPlayInfo: Boolean(info || legacy), format: info?.format || (legacy ? 'legacy' : null),
    duration: Number(info?.duration || legacy?.duration) || null,
    codec: info?.codec_type || null, hasSeparateAudio: Boolean(info?.audio),
    requiresProtectedPlayer: Boolean(info?.kid && info?.player_access_key),
    hasDirectLegacyMedia: Boolean(legacy?.main_url),
    // 访问密钥、kid、签名 URL 不进入结果文件。
  };
}

export async function getHotList() {
  const response = await requestText(`${WEB_ORIGIN}/api/category/page?page_num=1&tab=2&sort_type=2`, { headers: { Accept: 'application/json' } });
  const result = inspectJsonResponse(response.status, response.text);
  const { data, ...summary } = result;
  return { ...summary, returnedSuccess: data?.isSuccess === true,
    count: Array.isArray(data?.recommendList) ? data.recommendList.length : 0,
    items: (data?.recommendList || []).slice(0,8).map(item => ({ id: String(item.series_id || ''), title: item.series_name || item.title || '' })) };
}
