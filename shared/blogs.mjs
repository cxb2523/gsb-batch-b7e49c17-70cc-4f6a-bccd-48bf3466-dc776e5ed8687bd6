// Shared catalog builder: turns the chinese-independent-blogs data files
// (blogs-original.csv + the generated README table) into the flat catalog the
// city renders from.
//
// Runs both in Node (scripts/build-blogs.mjs) and in the browser/worker, so it
// is plain ESM with no dependencies. Types live in ./blogs.d.ts.
//
// Category matching is ported from the list's own site
// (chinese-independent-blogs/frontend/worker/categories.js, ISC).

export const CATEGORIES = [
  {
    id: 'dev',
    name: '编程开发',
    re: /编程|技术|前端|后端|开发|代码|程序|linux|python|java|golang|^go$|rust|android|ios|算法|架构|运维|数据库|devops|web|全栈|软件|开源|docker|k8s|kubernetes|服务器|网络|cloudflare|数据|计算机/i,
  },
  {
    id: 'ai',
    name: '人工智能',
    re: /^ai$|人工智能|llm|大模型|gpt|claude|机器学习|深度学习|prompt|提示词/i,
  },
  {
    id: 'life',
    name: '生活随笔',
    re: /生活|随笔|日常|记录|日记|随想|感悟|杂谈|碎碎念|心情|情感|家庭|育儿|个人/,
  },
  {
    id: 'think',
    name: '思考观点',
    re: /思考|观点|认知|成长|哲学|社会|评论|心理|反思/,
  },
  {
    id: 'read',
    name: '读书写作',
    re: /读书|阅读|书评|写作|文学|小说|诗|历史|人文|笔记/,
  },
  {
    id: 'travel',
    name: '摄影旅行',
    re: /摄影|旅行|旅游|游记|徒步|骑行|户外|城市|风景/,
  },
  {
    id: 'product',
    name: '产品商业',
    re: /产品|设计|ui|ux|交互|创业|商业|运营|管理|职场|营销|投资|理财|经济|金融/i,
  },
  {
    id: 'tools',
    name: '效率工具',
    re: /效率|工具|生产力|软件推荐|mac|apple|数码|折腾|nas|homelab|智能家居|分享|资源|教程/i,
  },
  {
    id: 'security',
    name: '安全',
    re: /安全|渗透|ctf|逆向|漏洞|hack/i,
  },
  {
    id: 'culture',
    name: '影音游戏',
    re: /游戏|电影|影视|音乐|动漫|二次元|acg|追剧|影评|美食|体育|运动/i,
  },
];

/** Map a blog's free-form tags onto the fixed category ids. */
export function categorize(tags) {
  const ids = new Set();
  for (const tag of tags) {
    for (const cat of CATEGORIES) {
      if (cat.re.test(tag)) ids.add(cat.id);
    }
  }
  return [...ids];
}

/** Stable id for a blog: host + path, no protocol, no trailing slash. */
export function blogId(url) {
  let u = String(url || '').trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  u = u.replace(/\/+$/, '');
  u = u.replace(/[?#].*$/, '');
  return u;
}

function splitTags(raw) {
  return String(raw || '')
    .split(/[;；,、，|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Parse blogs-original.csv → [{ name, url, feed, tags }] in file order. */
export function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^introduction\s*,/i.test(line)) continue;
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const name = parts[0].trim();
    const url = parts[1].trim();
    // A comma can only legally appear inside the feed url, so keep everything
    // between the address and the tags column as the feed.
    const feed = (parts.length > 3 ? parts.slice(2, -1).join(',') : parts[2] || '').trim();
    const tags = splitTags(parts[parts.length - 1]);
    if (!name || !/^https?:\/\//i.test(url)) continue;
    rows.push({ name, url, feed, tags });
  }
  return rows;
}

// The Feed cell is `[Feed](url)` when the blog has a feed, or `None` when it
// does not. Both are rows of the table, and the second kind used to be skipped
// entirely — see noFeed below.
const FEED_ROW =
  /^\|\s*(?:\[Feed\]\(([^)]*)\)|(None))\s*\|\s*(.*?)\s*\|\s*(https?:\/\/[^|]*?)\s*\|\s*(.*?)\s*\|?\s*$/i;

/**
 * Parse the generated README table.
 * - before "### 疑似失效": blogs sorted by most recent post → freshness rank
 * - after it: the failing blogs, with the failure reason
 */
export function parseReadme(text) {
  const active = [];
  const dead = [];
  let inDead = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^###\s*疑似失效/.test(line)) {
      inDead = true;
      continue;
    }
    if (!line.startsWith('|')) continue;
    const feedMatch = line.match(FEED_ROW);
    if (feedMatch) {
      if (inDead) continue;
      active.push({
        name: feedMatch[3].trim(),
        url: feedMatch[4].trim(),
        feed: (feedMatch[1] || '').trim(),
        tags: splitTags(feedMatch[5]),
      });
      continue;
    }
    if (inDead) {
      const cells = line.split('|').map((c) => c.trim());
      // | name | address | reason |  → ["", name, address, reason, ""]
      if (cells.length >= 4 && /^https?:\/\//i.test(cells[2])) {
        dead.push({ name: cells[1], url: cells[2], reason: cells[3] || '' });
      }
    }
  }
  return { active, dead };
}

/**
 * Build the city catalog.
 * @returns {{ generatedAt: string, source: string, stats: object, blogs: object[] }}
 */
export function buildCatalog({ csvText, readmeText, health, generatedAt, now }) {
  const rows = parseCsv(csvText);
  const { active, dead } = parseReadme(readmeText);
  const healthById = health instanceof Map ? health : new Map(Object.entries(health || {}));
  const nowMs = now ?? Date.now();

  // Rank is counted over the rows that actually have a feed: the no-feed rows
  // sit at the tail of the table and must not stretch everyone else's scale.
  const ranked = active.filter((b) => b.feed);
  const total = Math.max(1, ranked.length);
  const state = new Map();
  ranked.forEach((b, i) => {
    state.set(blogId(b.url), { fresh: 1 - i / total, dead: false, reason: '', noFeed: false });
  });
  for (const b of active) {
    if (b.feed) continue;
    // No RSS: never checked, never will be. Treat it as quiet, not as "new".
    state.set(blogId(b.url), { fresh: 0, dead: false, reason: '', noFeed: true });
  }
  for (const b of dead) {
    const id = blogId(b.url);
    if (state.has(id) && !state.get(id).dead) continue; // still listed as alive
    state.set(id, { fresh: 0, dead: true, reason: b.reason, noFeed: false });
  }

  // Our own crawl, when present, beats the README: it carries real timestamps,
  // so freshness is a decay curve in time instead of a rank percentile.
  for (const [id, h] of healthById) {
    const prev = state.get(id) ?? { fresh: 0, dead: false, reason: '', noFeed: false };
    if (h.deadSince) {
      state.set(id, { ...prev, fresh: 0, dead: true, reason: h.reason || prev.reason });
      continue;
    }
    if (h.lastPostAt) {
      const ageDays = Math.max(0, (nowMs - h.lastPostAt * 1000) / 86400000);
      // Hyperbolic decay: 1 day ≈ 0.99, 30 ≈ 0.75, 90 ≈ 0.5, 1 year ≈ 0.2
      state.set(id, { ...prev, fresh: Math.round((1 / (1 + ageDays / 90)) * 1000) / 1000, dead: false });
    }
  }

  const blogs = rows.map((row, index) => {
    const id = blogId(row.url);
    const st = state.get(id);
    return {
      id,
      num: index + 1,
      name: row.name,
      url: row.url,
      feed: row.feed,
      tags: row.tags,
      dead: st ? st.dead : false,
      reason: st && st.reason ? st.reason : '',
      ...(st?.noFeed && { noFeed: true }),
      ...(healthById.get(id)?.lastPostAt && { lastPostAt: healthById.get(id).lastPostAt }),
      // 1 = most recently updated, 0 = long silent. Unknown blogs (added to the
      // CSV after the last README render) start mid-scale rather than near the
      // top: we genuinely do not know how active they are yet.
      fresh: st ? Math.round(st.fresh * 1000) / 1000 : 0.5,
    };
  });

  let deadCount = 0;
  for (const b of blogs) if (b.dead) deadCount++;

  return {
    generatedAt: generatedAt || '',
    source: 'chinese-independent-blogs',
    stats: {
      total: blogs.length,
      dead: deadCount,
      tagged: blogs.filter((b) => b.tags.length > 0).length,
      matchedInReadme: blogs.filter((b) => state.has(b.id)).length,
    },
    blogs,
  };
}
