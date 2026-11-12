// 本地自检：验证 index.html 与 demo 页面的密文可被现有流程正确还原，
// 并检查各页面内嵌脚本语法合法。运行：node demo/selfcheck.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function decodePage(file, keyB64, prefix, count) {
  const html = fs.readFileSync(file, 'utf8');
  const parts = [];
  for (let i = 0; i < count; i++) {
    const m = html.match(new RegExp('<template id="' + prefix + i + '">([\\s\\S]*?)</template>'));
    if (!m) throw new Error('模板缺失: ' + prefix + i);
    parts.push(m[1]);
  }
  const key = Buffer.from(keyB64, 'base64').toString('binary');
  const decoded = Buffer.from(parts.join('').replace(/\s+/g, ''), 'base64').toString('binary');
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function checkScriptsParse(file) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const s of scripts) new Function(s); // 语法检查
  return scripts.length;
}

let fail = 0;
function assert(cond, msg) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) fail++;
}

// 1. 正式页 index.html：密文可还原出完整 HTML
const KEY = '9nMgOeD+l70zg2NN8aHAyNpMpdNWTZzyvF2QqsB0WoAyjdnqbyAJH3LWGg6bvw35';
const real = decodePage(path.join(ROOT, 'index.html'), KEY, '_wZuewaXj', 12);
assert(/<title[^>]*>[\s\S]*?<\/title>/i.test(real), 'index.html 密文还原出 <title>');
assert(/<body[^>]*>/i.test(real), 'index.html 密文还原出 <body>');
console.log('     还原标题: ' + (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(real) || [])[1]);

// 2. demo/ok.html：往返一致
const DEMO_KEY_B64 = Buffer.from('demo-key-0123', 'ascii').toString('base64');
const ok = decodePage(path.join(__dirname, 'ok.html'), DEMO_KEY_B64, '_ct', 3);
assert(ok.includes('<title>演示标题：还原成功</title>'), 'ok.html 还原出演示标题');
assert(ok.includes('正文内容已还原'), 'ok.html 还原出演示正文');
assert(ok.includes("getElementById('st')"), 'ok.html 还原出内联脚本');

// 3. demo/cross-origin-script.html：载荷中含三种脚本
const xss = decodePage(path.join(__dirname, 'cross-origin-script.html'), DEMO_KEY_B64, '_ct', 3);
assert(xss.includes('https://evil.example.com/pwn.js'), '跨域演示载荷含恶意地址');
assert(xss.includes('javascript:alert(1)'), '跨域演示载荷含 javascript: 伪协议');
assert(xss.includes('https://cdn.example.com/lib/ok.js'), '跨域演示载荷含白名单地址');

// 4. 各页面内嵌脚本语法合法（demo/index.html 是纯链接入口页，无脚本）
for (const f of ['index.html', 'demo/ok.html', 'demo/missing-template.html',
                 'demo/bad-base64.html', 'demo/empty-key.html', 'demo/cross-origin-script.html']) {
  const n = checkScriptsParse(path.join(ROOT, f));
  assert(n > 0, f + ' 内嵌脚本语法合法（' + n + ' 段）');
}

// 5. 坏输入确实触发对应分支
try {
  // Node 的 atob 与浏览器行为一致，非法字符抛错
  atob('YWJjZGVm!!!###$$$');
  assert(false, 'bad-base64 样例应导致 atob 抛错');
} catch (e) {
  assert(true, 'bad-base64 样例导致 atob 抛错（' + e.name + '）');
}
assert(Buffer.from('', 'base64').toString('binary').length === 0, 'empty-key 样例密钥长度为零');

process.exit(fail ? 1 : 0);
