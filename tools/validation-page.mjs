// Flies every aircraft against its handbook and writes validation.html: the
// numbers behind the claim, in the open.   node tools/validation-page.mjs
import { writeFileSync } from 'node:fs';
import { validate } from '../test/validate.mjs';
import { AIRCRAFT } from '../js/aircraft/index.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
let total = 0, passed = 0;
const sections = Object.values(AIRCRAFT).map((def) => {
  const rows = validate(def);
  total += rows.length; passed += rows.filter((r) => r.ok).length;
  const body = rows.map((r) => {
    const yesNo = r.tol === 0 && r.want === 1 && r.unit === '';
    return `<tr class="${r.ok ? '' : 'miss'}"><td>${esc(r.name)}</td><td class="n">${yesNo ? (r.got ? 'yes' : 'no') : fmt(r.got)}</td><td class="n">${yesNo ? 'yes' : fmt(r.want)}</td><td class="n">${yesNo ? '' : '± ' + fmt(r.tol)}</td><td>${esc(r.unit)}</td><td class="m">${r.ok ? '' : 'outside'}</td></tr>`;
  }).join('');
  const ok = rows.filter((r) => r.ok).length;
  return `<section><h2>${esc(def.name)}<span>${ok} of ${rows.length}</span></h2><p class="src">${esc(def.handbook ? def.handbook.source : '')}</p>
<table><thead><tr><th>Check</th><th class="n">Model</th><th class="n">Published</th><th class="n">Tolerance</th><th></th><th></th></tr></thead><tbody>${body}</tbody></table></section>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cayley validation</title>
<style>
:root{--ink:#14161a;--dim:#6b7078;--line:#d9d9d4;--paper:#f6f4ee;--accent:#ff5b1f}
*{box-sizing:border-box;margin:0}
body{background:var(--paper);color:var(--ink);font:15px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:clamp(24px,6vw,88px)}
main{max-width:900px;margin:0 auto}
h1{font-size:clamp(56px,11vw,132px);font-weight:800;letter-spacing:-.06em;line-height:.86;text-transform:uppercase}
.lede{margin:28px 0 8px;font-size:19px;max-width:62ch}
.meta{color:var(--dim);font-size:13px;margin-bottom:56px}
.big{font-size:clamp(40px,7vw,84px);font-weight:800;letter-spacing:-.05em;line-height:1;margin:36px 0 6px}
.big em{font-style:normal;color:var(--accent)}
section{margin-top:64px;break-inside:avoid-page}
h2{font-size:30px;font-weight:800;letter-spacing:-.035em;display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid var(--ink);padding-bottom:8px}
h2 span{font-size:14px;font-weight:600;letter-spacing:0;color:var(--dim)}
.src{color:var(--dim);font-size:13px;margin:8px 0 14px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{font-size:11px;font-weight:600;text-align:left;color:var(--dim);padding:6px 8px 6px 0;border-bottom:1px solid var(--line)}
td{padding:6px 8px 6px 0;border-bottom:1px solid var(--line);vertical-align:baseline}
.n{text-align:right}
tr.miss td{color:var(--accent);font-weight:600}
.m{font-size:12px;text-align:right}
code{font:13px ui-monospace,Menlo,monospace}
@media print{body{padding:12mm;background:#fff}section{margin-top:28px}}
</style></head><body><main>
<h1>Flown against the book</h1>
<p class="lede">Every aircraft in Cayley is built from published geometry and flown, headless, against its own handbook. This page is the result of that run, misses included.</p>
<p class="big">${passed}<em> / </em>${total}</p>
<p class="meta">checks inside tolerance · ${Object.keys(AIRCRAFT).length} aircraft · maximum weight, sea level, standard day unless stated · generated ${new Date().toISOString().slice(0, 10)} by <code>node tools/validation-page.mjs</code></p>
<p>Handbook figures and tolerances live in each aircraft's definition file under <code>js/aircraft/</code>. Section properties, parasite drag and propeller pitch were tuned within physical ranges to meet them, so the handbook rows show that each model performs like its aircraft. The wind-tunnel rows (lift-curve slope, span efficiency, loading, ground effect) and the handling rows are not tuned for: they are what the vortex model produces.</p>
${sections}
</main></body></html>`;
writeFileSync(new URL('../validation.html', import.meta.url), html);
console.log(`validation.html written: ${passed}/${total} across ${Object.keys(AIRCRAFT).length} aircraft`);
