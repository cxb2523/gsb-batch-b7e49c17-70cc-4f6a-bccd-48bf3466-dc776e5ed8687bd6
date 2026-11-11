import {readFile,writeFile} from 'node:fs/promises';
import {evaluateGate} from '../src/probe/gate.mjs';
const read=async name=>JSON.parse(await readFile(new URL(`../research/${name}`,import.meta.url),'utf8'));
const [web,native,playback,recommendation,labels,licenses]=await Promise.all([
 read('latest-result.json'),read('signed-series-inspection.json'),read('signed-full-playback-v3.json'),
 read('signed-recommendation-playback.json'),read('signed-rank-labels.json'),read('signing-license-check.json'),
]);
const evidence={searchVerified:web.searchVerified,recommendationsVerified:recommendation.recommendationPlaybackVerified,
 series:playback.series.map(s=>{
  const metadata=native.reports.find(m=>m.seriesId===s.seriesId),previous=web.series.find(m=>m.seriesId===s.seriesId);
  return {...s,shareVerified:previous?.shareVerified===true,episodeListVerified:metadata?.details.listMatchesWeb===true,
   expectedEpisodeCount:metadata?.details.entries.length,total:metadata?.details.entries.length};
 })};
const technicalGate=evaluateGate(evidence);
for(const s of evidence.series)for(const e of s.episodes){
 if(!e.playingVerified||!e.resumesAfterSeek||!(e.audioDecodedBytes>0)||!(e.frames>0)){
  technicalGate.passed=false;technicalGate.reasons.push(`${s.title} 第${e.order}集：解码或跳转恢复证据不足`);
 }
}
const report={generatedAt:new Date().toISOString(),technicalGate,scope:'stage-one-content-validation',
 historicalResearchEvidence:true,sourceReuseCleared:false,soundAuditionVerified:false,
 caveats:['3倍速从头播放至 ended；有解码画面/音轨证据，没有人工听音验收。','抽查两部各5集，不代表所有剧集或所有作品永远可用。','使用研究用跨应用签名 SDK；未验证独立漫剧 APP 的正式 SDK 适配。','公开仓库不含桌面 APP 源码，签名/密钥处理参考代码未找到许可证，未纳入可分发源码或安装包。'],
 evidence,recommendation,boards:labels,licenses};
await writeFile(new URL('../research/current-result.json',import.meta.url),JSON.stringify(report,null,2));
const table=evidence.series.map(s=>`| ${s.title} | ${s.total} | ${s.episodes.map(e=>e.order).join('、')} | ${s.episodes.every(e=>e.ended&&e.fullDurationVerified)?'通过':'未通过'} | ${s.episodes.every(e=>e.seekVerified&&e.resumesAfterSeek)?'通过':'未通过'} | ${s.sequentialPlaybackVerified?'通过':'未通过'} |`).join('\n');
const text=`# 新原生接口与完整播放验证\n\n验证时间：${report.generatedAt}。\n\n**完整内容技术验证：${technicalGate.passed?'通过':'未通过'}。本报告只评估第一阶段内容门槛；客户端与安装包的最新状态见 [桌面版验收](../docs/desktop-validation.md)。**\n\n## 实测\n\n| 作品 | 全集数 | 抽查集数 | 从头至结尾、时长比对 | 跳转及恢复 | 前三集自动连播 |\n|---|---:|---|---|---|---|\n${table}\n\n两部原生剧集列表与先前分享/网页列表逐集比对一致。播放器使用真实资源，在本机暂存校验完整字节数，媒体处理后提供标准 MP4 和 HTTP Range，3 倍速完整播放每个样本，没有用跳到结尾替代整集播放。完整时长同时与资源模型的精确 duration、详情的整数 duration 比对，误差小于 1 秒。所有样本需有非零视频解码帧和音频解码字节。没有人工试听，声音主观质量仍留给 Windows 客户端验收。\n\n自动连播单独记录 ended 触发下一资源，以及下一资源的 playing 事件。拖动在整集播放后另行测试，包含中点 seeked 和恢复进度。\n\n推荐入口：《${recommendation.title}》共 ${recommendation.total} 集，第 1 集 ${recommendation.episode.duration} 秒；完整播放、跳转和恢复 ${recommendation.recommendationPlaybackVerified?'通过':'未通过'}。该作品来自本次漫剧推荐榜，可进入同一套内容/媒体处理流程。推荐榜、热播榜、新剧榜均返回 code=0、各 15 个条目，选择器名称与请求分类对应。不代表同步手机个性化推荐。\n\n关键词搜索和分享导入沿用先前已验证的网页/分享解析。原生搜索当前仍 HTTP 200 空响应；不能报告为原生搜索已修复。\n\n## 参考项目的可移植部分\n\n用户给出的 waligoraamodio288-rgb/hongguo-desktop-releases 是发行仓库，不公开桌面 APP 源码。README 描述 WebView2、内置本地内容/签名服务；其第三方对应源码附件主要是 FFmpeg/OpenJDK，不包含私有应用源码。\n\n参考 TV APK 静态观察给出了新版单集 POST /novel/player/video_model/v1/，body 使用 video_id、content_type=1、biz_param.video_platform=3。本次使用新鲜签名后，aid=8704 的参数实验可获取两部漫剧的资源；并非只修改旧短剧请求里的 aid。\n\n资源为 CENC AES-CTR 加密，编码标记 bytevc1；浏览器直接使用这些地址能读取时长，但无法验证解码和播放。研究用媒体处理后已完成上述播放测试。签名研究没有使用手机、完整 Android 模拟器或账号；运行的是本机 JVM/unidbg SDK 指令模拟。第二阶段已独立实现运行组件自动管理，验收与打包记录见桌面版报告。\n\n## 已识别的问题与修正\n\n早期 fragmented MP4 验证不能跳转；现在使用具有索引的 MP4，并支持 Range。FFmpeg 的 exit=0 也可能伴随远程读取不完整：实验曾生成 19.87 秒与 51.27 秒的不完整文件。现在先校验源资源的实际字节数与 API size，再校验解码输出时长；不足时重新解析并重试一次，不接受截断内容。子进程输出在 close 后结算。\n\n历史 signed-full-playback.json 和 v2 是失败/诊断证据，不用于本次通过判定；最终播放证据见 signed-full-playback-v3.json 和 current-result.json。\n\n## 许可与阶段边界\n\nzhangbaio/hongguo 和 zero199901/fqnovel-unidbg 的 GitHub 元数据 license 均为 null，根许可证 API 均 404；这是“未找到许可”，不代表许可不存在，也不等于可随意复制。相关 Java/密钥处理代码仅保存在忽略目录用于本机研究，没有纳入项目 GPL 可分发源码，也没有包装进安装包。\n\n第二阶段已采用独立编写的 Java 桥接与 TypeScript 媒体流程，未复制未明确许可的研究仓库业务类。SDK 二进制再分发许可仍未核实，当前仅限用户本机个人构建。正式客户端的安装、播放、记录保留及尚未完成的全新 Windows 机器验收见桌面版报告。\n\n## 复查\n\n第一阶段原始测试为 23 项；当前客户端测试数量及执行结果见桌面版报告。npm run probe:signed：需本机研究 signer，只验证元数据，按设计保持未通过完整播放的退出状态。node scripts/summarize-signed-evidence.mjs：读取上述实测证据并执行内容门槛，不会重新播放或把资源元数据当成通过。签名、CDN URL、内容密钥均不写入报告。\n`;
await writeFile(new URL('../research/NATIVE-REPORT.md',import.meta.url),text);
console.log(JSON.stringify({technicalGate:technicalGate.passed,series:evidence.series.length,sourceReuseCleared:false}));
process.exitCode=technicalGate.passed?0:2;
