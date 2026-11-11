import { readFile } from 'node:fs/promises';
import { requestText, inspectJsonResponse } from './http.mjs';

// 只读取已经审查的上游常量，不 import、require 或执行第三方源码。
// 上游来源及 GPL-3.0 许可见 research/sources.json 和 LICENSE。
export async function loadReferenceConfig(snapshotPath) {
  const source = await readFile(snapshotPath, 'utf8');
  const block = source.match(/const COMMON_QUERY = (\{[\s\S]*?\n\});/)?.[1];
  if (!block) throw new Error('研究快照没有预期的请求常量');
  const query = JSON.parse(block.replace(/^(\s*)([a-zA-Z_][\w]*):/gm, '$1"$2":').replace(/,\s*}/g, '}'));
  const userAgent = source.match(/const UA = "([^"]+)"/)?.[1];
  if (!userAgent) throw new Error('研究快照缺少请求头常量');
  return { query, userAgent };
}

export async function probeNativeApi(config, series, aid, type) {
  const path = `/novel/player/multi_video_${type}/preload/v1`;
  const url = new URL(path, 'https://api5-normal-sinfonlineb.fqnovel.com');
  for (const [key, value] of Object.entries({ ...config.query, aid, _rticket: String(Date.now()) })) url.searchParams.set(key, value);
  const body = type === 'detail' ? {
    biz_param: { detail_page_version: 0, disable_digg_stat: false, need_all_video_definition: false,
      need_mp4_align: false, screen_width_px: '900', source: 7, use_os_player: false, use_server_dns: false },
    dr_scene: 'preload', series_id: series.seriesId,
  } : {
    biz_param: { detail_page_version: 0, device_level: 3, disable_digg_stat: false, need_all_video_definition: true,
      need_mp4_align: false, use_os_player: false, use_server_dns: false, video_platform: 1024 },
    dr_scene: 'preload', mixed_video_id_map: { '1004': [series.episodes[0].id] },
  };
  const response = await requestText(url, { method: 'POST', timeout: 20000, attempts: 1,
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json; charset=utf-8,application/x-protobuf',
      'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const inspected = inspectJsonResponse(response.status, response.text);
  const { data, ...summary } = inspected;
  return { seriesId: series.seriesId, aid, type, endpoint: path, ...summary,
    ...(data ? { topLevelKeys: Object.keys(data), itemCount: Object.keys(data.data || {}).length } : {}) };
}
