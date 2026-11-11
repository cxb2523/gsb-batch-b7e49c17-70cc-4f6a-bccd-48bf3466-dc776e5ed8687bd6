import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Signer } from '../src/main/transport';
import { safeJson } from '../src/main/json';

// Probe only. This does not alter the released provider and never executes APK code.
const identity = { aid: '8704', app_name: 'kylin_read', version_code: '74032', version_name: '7.4.0.32', update_version_code: '74032' };
const out = path.resolve('research/independent');
const signer = new Signer(path.resolve('runtime-bundle'), path.join(out, 'signer-work'));
const report: any[] = [];
const queries = ['到末世十年后竟然遇到四个尸王', '反向拿捏'];
// g69Q.<clinit> supplies this default host to BookApiService.
const hosts = ['reading.snssdk.com'];
const versions = ['', ':version'];
const paramSets = [{ name: 'baseline', tab_name: 'feed', search_source: '1', count: '0', use_correct: 'true' }];

function summarize(value: any) {
  const nodes: any[] = [];
  const visit = (v: any, depth = 0) => { if (!v || typeof v !== 'object' || depth > 10 || nodes.length > 2000) return; if (!Array.isArray(v)) nodes.push(v); for (const x of Object.values(v)) visit(x, depth + 1); };
  visit(value);
  const tabs = nodes.filter(v => Array.isArray(v.data) || v.tab_name || v.search_type).slice(0, 10).map(v => ({ keys: Object.keys(v), tab_name: v.tab_name, search_type: v.search_type, count: Array.isArray(v.data) ? v.data.length : undefined, has_more: v.has_more, next_offset: v.next_offset }));
  const ids = [...new Set(nodes.map(v => v.series_id).filter((v): v is string => typeof v === 'string'))].slice(0, 20);
  return { code: value?.code ?? value?.BaseResp?.StatusCode, keys: Object.keys(value ?? {}), tabs, ids };
}

try {
  for (const host of hosts) for (const version of versions) for (const query of queries) for (const set of paramSets) {
    const endpoint = `/reading/bookapi/search/tab/v${version}/`;
    const url = new URL(endpoint, `https://${host}`);
    const { name: variant, ...params } = set;
    for (const [k, v] of Object.entries({ ...identity, channel: 'audit', device_platform: 'android', os_version: '12', _rticket: Date.now(), query, offset: '0', ...params })) url.searchParams.set(k, String(v));
    const headers = { 'user-agent': 'com.kylin.read/74032 (Linux; Android 12)', 'content-type': 'application/json; charset=utf-8' };
    try {
      const signed = await signer.sign(url.href, headers);
      const response = await fetch(url, { headers: { ...headers, ...signed }, signal: AbortSignal.timeout(15000) });
      const body = await response.text();
      let summary: any;
      try { summary = body.trim() ? summarize(safeJson(body)) : { empty: true }; } catch { summary = { nonJson: true }; }
      const row = { host, version, query, variant, http: response.status, bytes: Buffer.byteLength(body), contentType: response.headers.get('content-type'), summary };
      report.push(row); console.log(JSON.stringify(row));
    } catch (error) { report.push({ host, version, query, variant, error: error instanceof Error ? error.name : 'FAILED' }); }
  }
} finally { signer.close(); await mkdir(out, { recursive: true }); await writeFile(path.join(out, 'search-default-host.json'), JSON.stringify(report, null, 2)); }
