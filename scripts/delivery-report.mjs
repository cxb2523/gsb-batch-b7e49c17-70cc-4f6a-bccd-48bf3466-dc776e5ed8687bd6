import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const ui=JSON.parse(await readFile('outputs/electron-qa.json','utf8'));
const installed=JSON.parse(await readFile('outputs/installed-qa.json','utf8'));
assert.equal(ui.passed,true,'Desktop UI validation is incomplete');
assert.equal(installed.passed,true,'Installed application validation is incomplete');
const testOutput=await readFile('outputs/test-results.txt','utf8');
const passes=[...testOutput.matchAll(/ℹ pass (\d+)/g)].reduce((n,m)=>n+Number(m[1]),0);
assert.equal(passes,55);assert.ok(!/ℹ fail [1-9]/.test(testOutput));
const file='release/Hongguo-Manju-0.2.0-Windows-x64.exe';const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
const resumed=installed.events.find(e=>e.step==='installed-close-reopen-resume');
const runtime=installed.events.find(e=>e.step==='installed-runtime-without-development-path');
const report={generatedAt:new Date().toISOString(),version:'0.2.0',installer:{file,sha256,bytes:(await stat(file)).size,signature:'not-signed'},tests:{passed:passes,failed:0,typecheck:true},desktopUi:ui.passed,installed:installed.passed,installedPath:runtime.executable,limits:{cleanWindowsMachine:false,humanSoundAudition:false,allEpisodesWatched:false,publicDistribution:false}};
await writeFile('outputs/desktop-release.json',JSON.stringify(report,null,2));
const text=`# Windows 客户端 0.2.0 验收记录

生成时间：${report.generatedAt}。本机 Windows x64 个人版本已构建、安装并完成以下验证。

## 功能与实际验证

| 项目 | 证据及结果 |
|---|---|
| 原生榜单 | 安装版推荐榜、热播榜、新剧榜分别返回15项，标题与选择器一致；封面可加载 |
| 推荐卡片 | UI测试点击推荐作品后，详情标题匹配并实际播放，有画面和音频解码 |
| 搜索 | 输入指定漫剧标题，搜索结果命中原作品；来源只提供一个结果集，未虚构下一页 |
| 分享导入 | 原链接导入《到末世十年后竟然遇到四个尸王第一季》，完整155集，自动收藏 |
| 完整连续播放 | 第1、2、3集分别60.033333、45.133333、45.7秒；以2倍速完整播到ended，自动进入下一集，帧数及音频解码字节均大于零 |
| 随机选集 | 第78、155集进入正确分集，时长45.033333、37.633333秒，画面/音频解码和拖动正常 |
| 播放控制 | 进度拖动、音量0.5、2倍速、进入/退出全屏通过实际UI操作 |
| 播放失败重试 | 注入播放器错误后，自动重新取得同集一次；再次出错显示手动重试，点击可恢复。没有替换作品 |
| 网络失败 | 主进程模拟网络不可用，UI显示明确网络提示；恢复后点击重试成功 |
| 关闭重开 | 通过真实BrowserWindow关闭，等待最终保存，重启后收藏保留；安装版保存${resumed.saved}秒，恢复到${resumed.resumed}秒 |
| 安装与独立运行 | NSIS本机安装退出0；安装版isPackaged=true，PATH仅保留Windows系统目录，使用自带Java和媒体组件，首集/下一集播放成功 |
| 自动检查 | ${passes}项测试通过，0失败；TypeScript检查与生产构建通过 |

阶段一另有两部作品各5集的完整播放证据，见 [内容门槛](../research/NATIVE-REPORT.md)。阶段二详细机器记录见 [UI验证](../outputs/electron-qa.json)、[安装验证](../outputs/installed-qa.json) 和 [发布汇总](../outputs/desktop-release.json)。

## 修复与打包检查

已修复：19位编号精度丢失、原生资源status=10成功状态、榜单简介字段、关闭事件中再次关闭被忽略、旧签名进程退出误伤新请求、坏记录清空整个库、保存失败内存状态先行、Windows打开视频文件时强制刷新无法覆盖缓存、退出后仍启动媒体进程、分享页偶发缺失JSON数据。相关边界有回归测试。

安装载荷将SDK的.so文件通过NSIS单独封装，并关闭差分包：当前7z会给Android ELF自动应用ARM64过滤，NSIS自带旧解码器未解出这两个文件，因此不让这些文件进入7z载荷。修复后的安装版逐一核对3个SDK文件SHA256，通过后才开始运行验证。构建后也校验Java、桥接类、依赖JAR、FFmpeg及SDK清单。

自带运行组件通过标准输入输出自动启动/退出，没有HTTP研究服务，也不要求手机、另装完整Android模拟器或额外Java安装。签名和密钥在主进程及子进程内部处理；渲染层只有本机媒体地址与作品数据。

## 交付与边界

安装包：\`${file}\`，${(report.installer.bytes/1024/1024).toFixed(1)} MiB。SHA256：\`${sha256}\`。已安装程序：\`${runtime.executable}\`，开始菜单和桌面快捷方式为「红果漫剧桌面版」。

源码ZIP不含研究仓库快照、SDK或个人媒体/记录；开发时可复制安装目录下的\`resources/runtime-bundle\`，详见 [使用与构建](../README.md)。

本次是在现有电脑上安装，并以精简PATH验证运行依赖；**尚未在全新、没有开发环境的Windows电脑或虚拟机上验证**。音频有解码证据，但没有人工试听；没有逐集看完两部作品的全部281集。上游接口和分享页可能变化，不能保证全部作品永久可用。首版先准备完整单集再起播，长视频需要更久，当前优先540p。

安装包未数字签名，保留Electron默认程序图标；无公开更新源，不做公共分发。第三方SDK再分发许可未核实，当前仅供用户本机个人使用，见 [组件来源与许可](runtime-components.md)。
`;
await writeFile('docs/desktop-validation.md',text);console.log(JSON.stringify({installerSha256:sha256,tests:passes,installed:true}));
