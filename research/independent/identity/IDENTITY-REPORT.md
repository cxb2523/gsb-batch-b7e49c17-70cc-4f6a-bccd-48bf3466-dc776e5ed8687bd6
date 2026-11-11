# 独立「红果免费漫剧」App 身份核验

核验时间：2026-10-14；只读取公开分发页及既有 APK 文件，没有运行或安装 APK。

## 结论

**此前获取的 `com.kylin.read` APK 没有被认成另一个 App。** 腾讯应用宝将此包明确登记为独立「红果免费漫剧」，开发者/运营者为海南愉阅科技有限公司；用户给定的 Microsoft Store 产品 `XPFD4R4Q42LGG7` 指向同一个 Android 包。腾讯分发记录还明确写明其由「咸柠免费短剧」升级为「红果免费漫剧」。

| 项目 | 独立红果免费漫剧 | 红果免费短剧（对照） |
|---|---|---|
| Android 包名 | `com.kylin.read` | `com.phoenix.read` |
| 腾讯应用宝 app_id | `54532207` | `54278041` |
| 本次商店版本 | `7.4.0.32` | `7.3.9.32` |
| 开发者/运营者 | 海南愉阅科技有限公司 | 北京笔墨留香科技有限公司 |
| App 备案号 | 琼ICP备2022015412号-72A | 京ICP备2021028909号-28A |
| Microsoft Store 产品 | `XPFD4R4Q42LGG7` | `XP8JZM5H793BLK` |

**该结论只解决 App 身份，不证明既有客户端调用的每个内容接口、分类参数或内容类型均来自独立漫剧 App。** 两个应用的代码/API/内容是否共用，需要另行检查实际请求，不能凭 App 名称、相似 UI 或共享域名判断。

## 直接证据

1. [腾讯应用宝独立漫剧详情](https://sj.qq.com/appdetail/com.kylin.read)：正文与 `__NEXT_DATA__` 均给出上表身份。简介原文：`【品牌升级】「咸柠免费短剧」已正式升级为「红果免费漫剧」，为您带来更丰富、更精彩的漫剧内容`。完整存档 `qq_kylin.html` / `qq_kylin_next.json`。
2. [用户给定 Microsoft Store 页面](https://apps.microsoft.com/detail/xpfd4r4q42lgg7?hl=zh-CN&gl=CN)：`window.pageMetadata` 的 `title=红果免费漫剧`、`publisherId=海南愉阅科技有限公司`、`installer.type=TencentAndroid`、`installer.id=com.kylin.read`、`installer.extras.PackageId=com.kylin.read`、`VersionCode=74032`、`catalogSource=TencentAppStore`。完整存档 `microsoft.html`，已解析 `microsoft_metadata.json`。Microsoft Store 使用腾讯目录，因此这两者属于互相对应的分发记录，不能算两个完全独立的出版方确认。
3. [用户给定分享页面](https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/)：实际跳转至 `https://hainanyuyue.com/share/video-animation-share?...`，正文写「红果漫剧」「打开『红果漫剧』观看全集」，页脚为「红果免费漫剧｜海南愉阅科技有限公司」。与商店身份一致。完整存档 `share.html`。该页原始数据实际出现 `params.aid=8704`，此数字来自页面，不是猜测；这里不据此推断其适用于所有原生接口。
4. [腾讯应用宝红果短剧对照页](https://sj.qq.com/appdetail/com.phoenix.read)：给出 `com.phoenix.read`、北京笔墨留香、7.3.9.32，明确与漫剧独立分发记录不同。存档 `qq_phoenix.html` / `qq_phoenix_next.json`。

## 可靠 APK 来源与既有文件匹配

[腾讯应用宝移动分发页](https://a.app.qq.com/o/simple.jsp?pkgname=com.kylin.read) 的 `window.systemData.appDetail` 直接提供 `packageName`、`appName`、`developer`、`versionName`、`apkUrl`、`apkMd5`、`fileSize`。原始存档 `qq_mobile.html`，解析数据 `qq_mobile_metadata.json`。

- [HTTPS APK 分发地址](https://imtt.dd.qq.com/sjy.00022/sjy.00004/16891/apk/25783BBB69D472105930E145AE4B262A.apk?fsname=com.kylin.read_7.4.0.32.apk)
- 原始 `apkUrl` 使用 `http://`；分发页自带下载脚本将其协议转换为 `https://`，上面的地址沿用这一公开逻辑，未猜路径或文件名。
- 版本：`7.4.0.32`；字节数：`137471217`；分发 MD5：`25783BBB69D472105930E145AE4B262A`。
- 对下载地址只做 4 字节 Range 读取，返回 HTTP `206`，`Content-Type: application/vnd.android.package-archive`，`Content-Range: bytes 0-3/137471217`，开头 `PK\x03\x04`。
- 对既有 `research/upstream/kylin-official.apk` 重新计算：大小 `137471217`、MD5 `25783bbb69d472105930e145ae4b262a`，与当前腾讯分发记录匹配。
- SHA-256：`26d1374c02dc7026b8e3ecba6769c402ce22607ffc3b95d31fd326945d11655a`。
- 结果存档：`apk-source-verification.json`。

此处的 MD5 匹配用于确认既有文件与腾讯分发记录相同。未另做开发者 APK 签名证书的独立身份核验，不把分发匹配等同于证书身份认证。

## 使用范围

可确定：App 名称、包名、版本、开发者/运营者、备案号、商店产品对应关系、旧名升级关系，以及当前既有 APK 与分发记录匹配。

待另行验证：独立 App 的运行时栏目、原生接口路由、搜索/推荐内容过滤以及视频播放协议。不能从分发页推导这些行为。
