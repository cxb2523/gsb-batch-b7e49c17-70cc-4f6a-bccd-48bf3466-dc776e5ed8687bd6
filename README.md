<p align="center">
  <img src="docs/logo.svg" width="96" height="96" alt="Blog City 标志：夜里亮着灯的一栋像素大厦" />
</p>

<h1 align="center">博客之城 · Blog City</h1>

<p align="center">
  <b><a href="https://play.mukunjin.com">play.mukunjin.com</a></b>
</p>

把[中文独立博客列表](https://github.com/timqian/chinese-independent-blogs)变成一座 3D 像素城市：
**每个博客是一栋楼**，越活跃楼越高、灯越亮，久未更新的缩在城郊。

![夜空下的城市：1581 座大厦，越新的博客灯越亮](docs/1.png)

![点开一栋楼：楼高、活跃度、最近发文时间和标签，以及打开博客的入口](docs/2.png)

站点是纯静态的，托管在 **Cloudflare Pages**，没有数据库、没有服务端。

---

## 本地跑起来

```bash
npm install
npm run dev          # http://localhost:3210
```

## 数据从哪来

三个来源，全部在**构建时**合并，浏览器里不做任何请求：

| 来源 | 提供什么 | 取法 |
| --- | --- | --- |
| `blogs-original.csv` | 名单本体：名称、网址、RSS、标签 | jsDelivr 镜像（raw.githubusercontent 在国内常被墙） |
| `indi.blog/api/blogs.json` | 每篇博客最近发文时间、是否失效、失败原因 | `npm run health` |
| `README.md` | 兜底：没有状态快照时按表格名次算活跃度 | 同 CSV |

`src/data/blogs.json` 是三者合并的结果（博客数量随上游名单变化，不在代码里写死）：

```bash
npm run health     # 拉一次状态接口 → data/health.json（1 个请求，约 1 秒）
npm run data       # 用本地 clone 的 CSV/README 重建城市快照
npm run refresh    # 上面两步的合并版：拉接口 + 拉最新 CSV/README + 重建
```

数据是**构建时打进包里**的，所以同步完要重新 `npm run build` 才会有新城市。
线上由 Cloudflare Pages 在每次 push 时构建。

上游的检测节奏（已核对它的仓库）：

- **每小时**：`frontend/worker` 的 cron（`7 * * * *`）检测到期的 RSS，写进 D1；
- **每天**：GitHub Actions（`updateInfo.yml`）把结果渲染进 README 并提交；
- 我们每**周四**拉一次它的状态接口，有变化才提交（`.github/workflows/sync-health.yml`）。

## 计算公式

所有数值都在生成数据时算好写进 JSON，前端不再随机；刷新页面、换设备，城市长得一模一样。

### 活跃度

两条路径，有自己抓的数据就用真实时间，没有就退回列表的名次：

```
// A. 自己的抓取（data/health.json 存在时）—— 推荐
fresh = 1 / (1 + 距上次发文的天数 / 90)

// B. 回退：README 的名次
fresh = 1 − (在 README 活跃列表中的名次 ÷ 有 RSS 的活跃博客总数)
```

A 的曲线：1 天 ≈ 0.99、30 天 ≈ 0.75、90 天 ≈ 0.5、一年 ≈ 0.2。
B 是名次百分比，时间轴被压扁（前 100 名都挤在 0.9 以上），只在没有抓取数据时使用。

几种特殊情况：

| 情况 | fresh | 说明 |
| --- | --- | --- |
| 出现在「疑似失效」小节 / `deadSince` 已写入 | 0 | `dead = true` |
| CSV 里没有 RSS 地址 | 0 | `noFeed = true`，永远无法检测 |
| CSV 有、README 里查不到（刚合并的 PR） | 0.5 | 未知不该等于「很新」 |

数据来自列表自己的公开状态接口 `https://indi.blog/api/blogs.json`（每小时由它的 Worker 重新检测、
响应缓存 1 小时）。它的 Worker 已经处理了所有 RSS 的坑 —— 证书错误、sitemap、缺失时区、被当成构建时间的
`updated`、域名复活 —— 判定阈值是：明确错误（SSL、不是 feed、404/410/530）持续 1 天、其它错误持续 7 天
判为疑似失效，满 90 天为已失效。我们只做一次字段映射：

```
lastPost.publishedAt → lastPostAt（unix 秒）
dead + failingSince  → deadSince
error                → reason
```

`scripts/sync-health.mjs` 拉一次接口（1 个请求，约 1 秒）写成 `data/health.json`，每天 02:17 UTC
由 GitHub Actions 执行（`.github/workflows/sync-health.yml`）。快照没有实质变化时不提交、不重新部署 ——
因为 `fresh` 是构建时用「当前时间 − lastPostAt」算的，快照放旧几天也不会失真。

### 楼

```
breadth = min(标签数, 8) ÷ 8                 // 兴趣广度
j       = 由 blog.id 哈希得到的 0~1 定值      // 同一个博客永远同一栋楼

score   = 0.60 · fresh^0.5
        + 0.26 · breadth^0.65
        + 0.14 · j

楼高     = 14 + 200 × score                   // 14 ~ 214
楼层数   = round(楼高 ÷ 3.2)
亮窗比例 = 0.08 + 0.80 · fresh^0.75
楼宽     = 7.6 + 3.8 × breadth + 1.8 × j      // 约 8 ~ 13
楼深     = 楼宽 × (0.90 + 0.22 × j₂)
窗列数   = max(2, round(楼宽 ÷ 2.7))

// 疑似失效的楼
楼高     = 9 + 13 · j
亮窗比例 = 0.015 + 0.02 · j
```

### 摆在哪

没有网格。城市先由**路网**定形：从市中心放射出 8 条大道，外侧套 3 环（半径 = 0.34 / 0.62 / 0.88 × R）。
楼是一颗颗撒在道路之间的：按 `fresh` 从高到低，每栋楼取一个「以市中心为圆心的半径环」
（`r = R · √(i / n)`，保证面积上均匀）+ 随机角度，然后用 AABB + 空间哈希做拒绝采样，
撞到别的楼、或离路面太近就换个角度重试；连续撞到 55% 的尝试次数后，才允许它往外圈滑。

两个密度旋钮在 `src/lib/layout.ts` 顶部：`GAP`（楼与楼的最小间距，现为 15）和
面积填充率 `0.205`（越小越散）。现在半径中位数 890、最远 1328。

结果：最新的博客密集在市中心，久未更新的自然漂到边缘；没有两栋楼重叠，也没有一条对齐的街道，
但大道和环路把城市串成了一个整体。

### 市中心

中间是一片半径 96 的圆盘：外圈是环形车道，里面是绿岛，岛上是石台和一座雕塑 ——
**就是 BLOG CITY 这八个字母本身**，用 helvetiker bold 字样挤出 3.4 的厚度，高 21，立在石台上。

单一朝向（朝向默认机位），不是四面环绕的牌子：走过去一个字一个字读，背面就是反面。
一份几何、一次 draw call，没有贴图、没有拼字方块。字体数据是 three 自带的那份 typeface.json
（约 61 KB，gzip 后 +24 KB）。

楼和树都不许进这个圈（树让到半径 126 外，楼让到 128 外），所以转盘四周是一圈真正的空地。

大道上停着约 180 辆小车：车身、车厢、前后灯、四个轮子，共 8 个盒子拼成一辆，
全部烘焙进**一个 InstancedMesh**，构建时算一次，之后完全静止、零每帧开销。
一条车道朝外、一条朝内，间距是随机的，所以会自然地聚成车流，而不是均匀排队。

### 树

两遍：先沿每条大道两侧、每条环路内外侧种行道树（间距 24），再在空地里撒一些零散的。
种之前逐个检查，落在路面上、压到楼的地基上、或离另一棵树太近（< 19）的都丢掉。
当前约 1.9k 棵（城市半径也变大了，所以单位面积比之前更稀），
分阔叶和针叶两种，树干 / 阔叶 / 针叶各一个 InstancedMesh。

## 操作

| 操作 | 效果 |
| --- | --- |
| 左键拖动 | 绕城市旋转、俯仰 |
| 右键拖动 | 平移（贴地滑动，旋转中心跟着走） |
| 滚轮 | 缩放 |
| 点大厦 | 飞过去并打开卡片 |
| 点空白 · `Esc` | 收起卡片，旋转中心交还城中心 |
| `R` | 随机看一间 |

平移有边界：`homeFor()` 按城市实际范围算出 `bound = reach × 1.12`，每帧把 `controls.target`
夹在 ±bound 内，并把相机平移相同的量 —— 撞到边界时画面停住，视角方向不变。
OrbitControls 本身没有平移限制，这是补在它之后的一层。

地面是一块纯黑的圆盘（半径 26000，远超相机 12000 的远裁剪面），所以永远看不到它的边，
只剩下远处被雾吃掉的黑。没有自定义着色器。

空闲时城市会自己慢慢转（`autoRotateSpeed = 0.15`），你一动它就永久停下。
点大厦的飞行是一段 1.4 秒的缓出插值（`progress += delta × 0.7`，`1 - (1-p)³`），
机位从「背离城中心」的一侧看向楼的正面 —— 这也是 git-city 的做法。

## 部署

托管在 **Cloudflare Pages**，走 Git 集成：连一次仓库，之后每次 push 自动构建上线。

### 第一次（只做一次）

面板 → Workers & Pages → Create → **Pages** → **Connect to Git** → 选 `mukunjin/blog-city`：

```
Framework preset:  None
Build command:     npm run build:ci
Build output:      dist
```

就这两个字段要填。**不要**在面板里写长命令或配 `NODE_VERSION`：

- 构建命令收在 `package.json` 的 `build:ci` 里（`(重建数据 || true) && vite build`），面板里只有一句，改逻辑改仓库即可，不会出现「面板和仓库不一致」；
- Node 版本由仓库里的 `.node-version` 文件指定（`22`），Pages 的构建镜像会读它。

保存后得到 `https://blog-city.pages.dev`；绑上自定义域名后正式地址是 **https://play.mukunjin.com**。

### 之后

```bash
git push          # 只有这一句
```

Pages 监听 push → 构建 → 上线，构建失败会发邮件。分支推送会生成独立预览：

```
main   → https://play.mukunjin.com                 （生产）
分支 X → https://x.blog-city.pages.dev            （预览，不影响生产）
```

改版式时开个分支推上去看效果，满意再合。回滚：项目 → Deployments → 选任意一次历史部署 → **Rollback**。

### 数据怎么更新

`.github/workflows/sync-health.yml`，每周四 10:17（北京时间）：

```
拉一次状态接口
 ├─ 快照没变 → 直接结束，不提交、不构建
 └─ 快照变了 → commit & push → Pages 自动重建 → 上线
```

想改成每天或每小时，改那行 `cron`（构建次数上限 500 次/月，现在用不到 5%）。

### 可选的加固

**① Deploy Hook（防 webhook 丢投递）**

Pages 项目 → Settings → Builds & deployments → Deploy hooks → Add，复制 URL，存到 GitHub 仓库 secret：

```
名称：CF_DEPLOY_HOOK
```

`sync-health.yml` 里已经有这一步：提交之后，如果这个 secret 存在就额外 POST 一次触发构建；不存在就跳过。不配也能用，页面更新依赖 webhook。

### 手动部署（一般用不上）

```bash
npm run deploy    # = build + wrangler pages deploy dist --project-name blog-city
```

需要 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 两个环境变量。日常不用它，Git 集成已经覆盖。

## 添加新博客

1. 往 `chinese-independent-blogs/blogs-original.csv` 尾部加一行：`名称, 网址, RSS, 标签`
   （长期做法是给上游仓库提 PR，让所有人都有这栋楼）；
2. `npm run refresh` 重新拉数据并生成城市快照；
3. `git push` 发布。

还没进 README 的新博客会按「最新收录」处理，先给一个偏高的活跃度；等上游把 README 同步之后，位置就按真实发文时间落定。

## 代码结构

```
shared/blogs.mjs        CSV + README 解析、快照构建（Node 与浏览器通用）
scripts/build-blogs.mjs 生成 src/data/blogs.json
src/lib/metrics.ts      楼的视觉编码（高度 / 亮窗 / 占地）
src/lib/layout.ts       城市平面：方格路网 → 中心向外分配地块 → 落楼
src/scene/Buildings.tsx 全城一次 draw call 的实例化楼体，窗户由 shader 程序化绘制
src/scene/Backdrop.tsx  天空、星空、月亮、统一色的地面与环城路
src/ui/                 HUD、搜索目录、博客详情
wrangler.jsonc          Workers 静态资源配置
```

## 数据与致谢

- 名单来自 [timqian/chinese-independent-blogs](https://github.com/timqian/chinese-independent-blogs)（ISC）。
- 3D 城市的玩法参考了 [srizzon/git-city](https://github.com/srizzon/git-city)（AGPL-3.0）——本项目代码为独立实现，未复制其源码。
- 楼体、天空、地面均为自制 shader，无第三方美术资源。
