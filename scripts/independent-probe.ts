import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Signer } from '../src/main/transport';
import { safeJson } from '../src/main/json';

// APK-derived identity. This experiment never changes the released provider.
const identity = { aid: '8704', app_name: 'kylin_read', version_code: '74032', version_name: '7.4.0.32', update_version_code: '74032' };
const output = path.resolve('research/independent');
const signer = new Signer(path.resolve('runtime-bundle'), path.join(output, 'signer-work'));
const report: any = { generatedAt: new Date().toISOString(), identity, releasedProviderChanged: false, results: [] };

function summarize(json: any) {
 const nodes: any[] = [];
 const visit = (value: any, depth = 0) => {
  if (depth > 12 || !value || typeof value !== 'object' || nodes.length > 1200) return;
  if (!Array.isArray(value)) nodes.push(value);
  for (const child of Object.values(value)) visit(child, depth + 1);
 };
 visit(json);
 const labels = [...new Set(nodes.flatMap(node => ['show_name', 'tab_name', 'name', 'title', 'series_title', 'series_name'].map(key => typeof node[key] === 'string' && node[key].length < 130 ? node[key] : null).filter(Boolean)))].slice(0, 60);
 const works = [...new Map(nodes.filter(node => typeof node.series_id === 'string' && (node.series_title || node.series_name || node.title) && String(node.series_title || node.series_name || node.title).length < 100).map(node => [node.series_id, { id: node.series_id, title: node.series_title || node.series_name || node.title, total: node.episode_cnt ?? node.serial_count }])).values()].slice(0, 30);
 const structural = nodes.flatMap(node => Object.entries(node).filter(([key, value]) => /^(tab_id|tab_type|cell_id|selector_item_id|is_selected|has_more|next_offset|search_type|search_id|cell_type|template_id)$/.test(key) && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => ({ [key]: value }))).slice(0, 100);
 const tabs = nodes.filter(node => typeof node.tab_name === 'string').map(node => ({name:node.tab_name,type:node.tab_type,keys:Object.keys(node),count:Array.isArray(node.data)?node.data.length:undefined}));
 return { code: json.code ?? json.BaseResp?.StatusCode ?? json.base_resp?.StatusCode, message: String(json.message ?? json.msg ?? '').slice(0,120), keys: Object.keys(json), dataKeys: json.data && typeof json.data === 'object' ? Object.keys(json.data) : [], labels, works, structural, tabs };
}

async function request(label: string, endpoint: string, extra: Record<string, string | number | boolean> = {}, body?: unknown) {
 const url = new URL(endpoint, 'https://api5-normal-sinfonlinea.fqnovel.com');
 for (const [key, value] of Object.entries({ ...identity, channel: 'audit', device_platform: 'android', os_version: '12', _rticket: Date.now(), ...extra })) url.searchParams.set(key, String(value));
 const payload = body === undefined ? undefined : JSON.stringify(body);
 const headers = { 'user-agent': 'com.kylin.read/74032 (Linux; Android 12)', 'content-type': 'application/json; charset=utf-8', ...(payload ? { 'x-ss-stub': createHash('md5').update(payload).digest('hex').toUpperCase() } : {}) };
 try {
  const signed = await signer.sign(url.href, headers);
  const response = await fetch(url, { method: payload ? 'POST' : 'GET', headers: { ...headers, ...signed }, body: payload, signal: AbortSignal.timeout(25000) });
  const text = await response.text();
  const result: any = { label, endpoint, http: response.status, bytes: Buffer.byteLength(text) };
  if (!text.trim()) result.error = 'EMPTY_RESPONSE';
  else {
   try { result.summary = summarize(safeJson(text)); }
   catch { result.error = 'NON_JSON_RESPONSE'; }
  }
  report.results.push(result); console.log(JSON.stringify(result));
 } catch (error) {
  const result = { label, endpoint, error: error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'REQUEST_FAILED' };
  report.results.push(result); console.log(JSON.stringify(result));
 }
}

await mkdir(output, { recursive: true });
try {
 if(process.env.INDEPENDENT_PROBE_STAGE==='routes'){
  // The APK's generated RPC templates end with a slash; DTO keys and
  // BookstoreTabType enum below are independently recovered from the DEX.
  await request('native-comic-series-route', '/reading/bookapi/bookmall/tab/v/', { tab_type:32,tab_index:0,client_req_type:2,client_template:2,screen_width_px:1080 });
  await request('native-search-route', '/reading/bookapi/search/tab/v/', {query:'到末世十年后竟然遇到四个尸王',tab_name:'feed',offset:0,search_source:1,count:0,use_correct:true});
 } else {
 await request('native-tabs', '/reading/bookapi/bookmall/tab/v', { client_req_type: 2, client_template: 2, screen_width_px: 1080 });
 await request('native-comic-tab', '/reading/bookapi/bookmall/tab/v', { tab_type:26, client_req_type:2,client_template:2,screen_width_px:1080 });
 await request('native-search-tab', '/reading/bookapi/search/tab/v', { query: '到末世十年后竟然遇到四个尸王', tab_name:'feed', offset:0,search_source:1,count:0,use_correct:true });
 await request('native-search-tab-second-sample', '/reading/bookapi/search/tab/v', { query:'反向拿捏',tab_name:'feed',offset:0,search_source:1,count:0,use_correct:true });
 await request('existing-board-independent-identity', '/reading/bookapi/bookmall/cell/change/v', { cell_id: '7470092475068071998', tab_type: 26, client_req_type: 2, client_template: 2, screen_width_px: 1080, selected_items: 'comic_series_rank', sub_selected_items: 'comic_series_hot_rank', offset: 0 });
 await request('series-independent-identity', '/novel/player/multi_video_detail/v1/', {}, { series_id: '7695370827507698713', biz_param: { detail_page_version: 0, disable_digg_stat: false, need_all_video_definition: false, need_mp4_align: false, screen_width_px: '1080', source: 7, use_os_player: false, use_server_dns: false } });
 }
} finally {
 signer.close();
 await writeFile(path.join(output, process.env.INDEPENDENT_PROBE_STAGE==='routes'?'native-routes-probe.json':'native-probe.json'), JSON.stringify(report, null, 2));
}
