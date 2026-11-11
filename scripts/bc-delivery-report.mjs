import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const output = 'outputs/bc-ui';
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const [layout, live, installed, checks, pkg] = await Promise.all([
  readJson(`${output}/layout-qa.json`), readJson(`${output}/electron-qa.json`),
  readJson(`${output}/installed-qa.json`), readJson(`${output}/automated-checks.json`), readJson('package.json'),
]);
assert.equal(layout.passed, true); assert.equal(live.passed, true); assert.equal(installed.passed, true);
assert.equal(checks.tests.passed, 55); assert.equal(checks.tests.failed, 0);
const runtime = installed.events.find(event => event.step === 'installed-runtime-without-development-path');
assert.equal(runtime.version, pkg.version);
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const installer = `release/Hongguo-Manju-${pkg.version}-Windows-x64.exe`;
const library = path.join(process.env.APPDATA, '红果漫剧桌面版', 'library.json');
const savedHash = await hash(`${output}/library-before-update.json`);
assert.equal(await hash(library), savedHash, 'Original personal library must remain unchanged');
const installedAsar = path.join(path.dirname(runtime.executable), 'resources', 'app.asar');
const asarHash = await hash(installedAsar);
assert.equal(asarHash, await hash('release/win-unpacked/resources/app.asar'));
const report = {
  generatedAt: new Date().toISOString(), version: pkg.version,
  installer: { file: installer, sha256: await hash(installer), bytes: (await stat(installer)).size },
  installedExecutable: runtime.executable, installedAsarSha256: asarHash,
  libraryPreserved: true, librarySha256: savedHash,
  checks: { coreTests: 55, typecheck: true, productionBuild: true, layout: true, realPlayback: true, installed: true },
};
await writeFile(`${output}/release.json`, JSON.stringify(report, null, 2));
await writeFile('docs/bc-ui-validation.md', `# 0.2.1 B/C 融合界面验证

用户已批准 B 布局与 C 配色融合稿。${report.generatedAt} 完成界面更新、Windows x64 打包及本机安装验证。

## 变化

移除宽侧栏，顶部提供推荐、热播、新剧、搜索、导入链接、收藏与历史。宽幅主视觉使用来源真实作品封面，米白渐变衬托墨黑标题，朱红按钮播放当前作品；下方圆点手动切换前三个作品。首页展示最多三部真实观看记录，无记录时显示空状态。收藏、搜索、详情、选集、导入弹窗、提示和错误状态沿用同一主题。视频画面保持原比例和黑色底，控制栏改为浅色。

不将 AI 示意图作为应用背景或作品封面，不写入示例作品和虚构推荐数据。内容来源与 0.2.0 相同：红果短剧/TV 接口体系的漫剧板块，尚未验证为独立漫剧 APP 的全部片库。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 核心自动检查 | TypeScript、生产构建与 55 项测试通过；安装包构建通过 |
| 窗口布局 | 1040×720、1400×920、1536×1024，无页面横向溢出；长标题下按钮在可用范围 |
| 主视觉操作 | 切换作品后标题改变，播放进入所选作品；三张继续观看卡片进入对应详情 |
| 真实推荐与搜索 | 推荐作品详情匹配并播放；搜索命中指定作品 |
| 分享导入 | 原链接导入原作品，155 集，自动收藏 |
| 完整播放 | 第 1、2、3 集完整到 ended 并自动连播；随机第 78、155 集可播及拖动 |
| 播放控制与错误 | 音量、倍速、全屏、自动重取一次与手动重试均通过 |
| 保存与续播 | 真实关闭重开后保存收藏与 12 秒观看位置；安装版也通过 |
| 安装版 | 版本 ${pkg.version}；三个榜单各 15 项；PATH 仅保留 Windows 系统目录，使用内置运行组件 |
| 原有记录 | 升级前后原用户 library.json SHA256 相同；测试使用隔离记录目录 |
| 安装载荷 | 3 项 SDK 校验通过；安装 app.asar 与构建载荷 SHA256 相同 |

布局测试使用明确的占位数据，以验证无图和长标题；真实播放及安装测试使用来源数据。机器记录分别为 outputs/bc-ui/layout-qa.json、electron-qa.json、installed-qa.json 与 release.json。实际截图在 outputs/bc-ui/。

初次真实 UI 检查在导入跳转处超时，单独复现与整套复测均通过，未修改内容接入逻辑。安装检查首次误将新增“继续观看”标题当成榜单标题，修正测试选择器后通过。

本次修改属于界面更新；既有内容来源与运行组件限制仍适用，见 desktop-validation.md 与 runtime-components.md。没有在全新的无开发环境 Windows 机器上验证，音频具有解码证据但未经人工试听。

## 交付

安装包：${installer}。SHA256：${report.installer.sha256}。

已更新原安装目录：${runtime.executable}。目录名称保留 0.2.0，程序实际版本为 ${pkg.version}。
`);
console.log(JSON.stringify(report));
